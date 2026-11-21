"""`mdu daily`: the scheduled run (PLAN §7 schedules; workflow `ingest-daily.yml`).

For each adapter in order: write listing projects, add listing events, queue documents. Then
fetch everything pending for the city and extract text from what was stored. A failing adapter
is logged as a failed `pipeline_run` and the others still run; the command then exits non-zero
so the workflow shows red. Every step is idempotent, so a second run the same day does nothing
but re-read the listings.
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


def run(  # noqa: PLR0913
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
    return result
