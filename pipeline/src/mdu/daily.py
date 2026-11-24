"""`mdu daily`: the scheduled run (PLAN §7 schedules; workflow `ingest-daily.yml`).

For each adapter in order: write listing projects, add listing events, queue documents. Then
fetch everything pending for the city, extract text, classify it, extract project fields, link,
place the council's decisions from the minutes, geocode, place projects in neighbourhoods, read
the consultation notices and write the summaries. A failing adapter is logged as a failed
`pipeline_run` and the others still run; the command then exits non-zero so the workflow shows
red. Every step is idempotent, so a second run the same day does nothing but re-read the listings.
The run ends with one `daily` row (succeeded, or failed with the failed steps), which the
watchdog reads to tell a missed or failed morning (M5.4, ADR 0021).
"""

from __future__ import annotations

import json
import traceback
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import psycopg

from mdu import stages
from mdu.core.adapter import Adapter
from mdu.core.http import PoliteClient
from mdu.core.streets import StreetIndex
from mdu.ingest import IngestStats, write_records


@dataclass
class DailyResult:
    steps: dict[str, dict[str, Any]] = field(default_factory=dict)
    failed: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.failed


def _log_failure(
    conn: psycopg.Connection[Any], city: str, adapter: str | None, stage: str, error: str
) -> None:
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """insert into pipeline_run (jurisdiction_id, adapter, stage, status, finished_at,
                   error, stats)
               select id, %s, %s, 'failed', now(), %s, '{}' from jurisdiction where slug = %s""",
            (adapter, stage, error[:2000], city),
        )


def _log_daily(conn: psycopg.Connection[Any], city: str, result: DailyResult) -> None:
    errors = "; ".join(f"{n}: {result.steps[n].get('error', '')}" for n in result.failed)
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """insert into pipeline_run (jurisdiction_id, stage, status, finished_at, error, stats)
               select id, 'daily', %s, now(), %s, %s from jurisdiction where slug = %s""",
            (
                "succeeded" if result.ok else "failed",
                errors[:2000] or None,
                json.dumps({"steps": len(result.steps), "failed": result.failed}),
                city,
            ),
        )


def run(  # noqa: PLR0913, PLR0915
    conn: psycopg.Connection[Any],
    client: PoliteClient,
    store: stages.TextStore,
    streets: StreetIndex,
    adapters: list[Adapter],
    *,
    city: str,
    fetch_limit: int = 300,
    max_bytes: int = stages.DEFAULT_MAX_BYTES,
    extract_limit: int = 1000,
    llm: Any = None,
    field_extractor: Any = None,
    addresses: Any = None,  # mdu.core.streets.AddressIndex
    bbox: tuple[float, float, float, float] | None = None,
    consult_reader: Any = None,
    summary_writer: Any = None,
    llm_monthly_usd: float = 5.0,
    neighbourhood_seeds: Callable[[], Any] | None = None,
    neighbourhood_names: dict[str, str] | None = None,
    log: Callable[[str], None] = lambda _: None,
) -> DailyResult:
    result = DailyResult()

    def step(name: str, adapter: str | None, stage: str, fn: Callable[[], dict[str, Any]]) -> None:
        try:
            counts = fn()
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"
            log(f"{name}: FAILED {error}")
            log(traceback.format_exc(limit=3))
            result.failed.append(name)
            result.steps[name] = {"error": error}
            _log_failure(conn, city, adapter, stage, error)
            return
        result.steps[name] = counts
        log(f"{name}: {json.dumps(counts, ensure_ascii=False)}")

    for adapter in adapters:
        if adapter.projects is not None:
            projects = adapter.projects

            def ingest(a: Adapter = adapter, build: Any = projects) -> dict[str, Any]:
                stats = IngestStats()
                records = build(client, streets, stats)
                write_records(
                    conn,
                    city=city,
                    adapter=a.key,
                    base_url=a.base_url,
                    records=records,
                    upload=store.put,
                    stats=IngestStats(
                        skipped_personal=stats.skipped_personal,
                        skipped_other=stats.skipped_other,
                    ),
                )
                return {"projects": len(records), "skipped_personal": stats.skipped_personal}

            step(f"{adapter.key} projects", adapter.key, "ingest", ingest)
        if adapter.events is not None:
            events = adapter.events

            def add_events(hook: Any = events) -> dict[str, Any]:
                return dict(hook(conn, client, store.put, streets))

            step(f"{adapter.key} events", adapter.key, "events", add_events)
        if adapter.discover is not None:
            find = adapter.discover

            def queue(a: Adapter = adapter, discover_fn: Any = find) -> dict[str, Any]:
                items = a.mark_never_mirror(discover_fn(client))
                found = stages.discover(
                    conn, city=city, adapter=a.key, base_url=a.base_url, items=items
                )
                return dict(found.counts)

            step(f"{adapter.key} discover", adapter.key, "discover", queue)

    def fetch_all() -> dict[str, Any]:
        r = stages.fetch(
            conn, client, city=city, limit=fetch_limit, upload=store.put, max_bytes=max_bytes,
            log=log,
        )  # fmt: skip
        return {**r.counts, "requests": r.requests}

    step("fetch", None, "fetch", fetch_all)

    def extract_all() -> dict[str, Any]:
        counts: Counter[str] = stages.extract(conn, store, city=city, limit=extract_limit).counts
        return dict(counts)

    step("extract", None, "extract", extract_all)

    def classify_all() -> dict[str, Any]:
        r = stages.classify(conn, store, city=city, llm=llm, monthly_usd=llm_monthly_usd, log=log)
        return dict(r.counts)

    step("classify", None, "classify", classify_all)

    def fields_all() -> dict[str, Any]:
        from mdu.project_fields import extract_fields  # noqa: PLC0415

        r = extract_fields(
            conn, store, city=city, extractor=field_extractor, monthly_usd=llm_monthly_usd,
            log=log,
        )  # fmt: skip
        return dict(r.counts)

    step("fields", None, "extract_fields", fields_all)

    def link_all() -> dict[str, Any]:
        from mdu import linker  # noqa: PLC0415

        r = linker.run(
            conn, store, city=city, streets=streets, extractor=field_extractor,
            monthly_usd=llm_monthly_usd, log=log,
        )  # fmt: skip
        return dict(r.counts)

    step("link", None, "link", link_all)

    facts = next((a.decision_facts for a in adapters if a.decision_facts), None)

    def decisions_all() -> dict[str, Any]:
        from mdu import decisions  # noqa: PLC0415

        if facts is None:
            return {"skipped": "no minutes adapter"}
        return dict(decisions.run(conn, city=city, streets=streets, facts=facts).counts)

    step("decisions", None, "decisions", decisions_all)
    # Projects created or joined by the linker get their fields the same day (mostly cached).
    step("fields after link", None, "extract_fields", fields_all)

    def geocode_all() -> dict[str, Any]:
        from mdu import geocode  # noqa: PLC0415
        from mdu.core.streets import AddressIndex  # noqa: PLC0415

        if bbox is None:
            return {"skipped": "no bounding box"}
        r = geocode.run(
            conn, store, city=city, bbox=bbox, streets=streets,
            addresses=addresses or AddressIndex({}),
        )  # fmt: skip
        return dict(r.counts)

    step("geocode", None, "geocode", geocode_all)

    def neighbourhoods_all() -> dict[str, Any]:
        from mdu import neighbourhoods  # noqa: PLC0415

        if bbox is None:
            return {"skipped": "no bounding box"}
        # Draws the approximate areas only the first time; then just assigns new projects.
        r = neighbourhoods.run(
            conn, city=city, bbox=bbox, seeds=neighbourhood_seeds, names=neighbourhood_names,
            log=log,
        )  # fmt: skip
        return dict(r.counts)

    step("neighbourhoods", None, "neighbourhoods", neighbourhoods_all)

    def consult_all() -> dict[str, Any]:
        from mdu import consultations  # noqa: PLC0415

        r = consultations.run(
            conn, store, city=city, reader=consult_reader, monthly_usd=llm_monthly_usd, log=log
        )
        return dict(r.counts)

    step("consult", None, "consult", consult_all)

    def summarize_all() -> dict[str, Any]:
        from mdu import summaries  # noqa: PLC0415

        r = summaries.run(
            conn, store, city=city, writer=summary_writer, monthly_usd=llm_monthly_usd, log=log
        )
        return dict(r.counts)

    step("summary", None, "summarize", summarize_all)
    _log_daily(conn, city, result)
    return result
