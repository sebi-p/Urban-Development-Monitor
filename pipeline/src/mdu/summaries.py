"""Summary stage (M4.2): `summary_ro` and `summary_en` for every visible project.

The input is the project's checked facts (title, kind, address, initiator, designer,
indicators) plus the pages `fields.select_pages` picks from its documents and those of projects
merged into it. Answers are cached in `extraction_run` (task `summarize`) by input, so a project
is summarised again only when its facts or documents change. Checked summaries
(`mdu.core.summary.check`) are written with their source in `indicators.summary`; a summary
that fails a check is not written, and an older one stays.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import psycopg

from mdu.core import fields, summary
from mdu.project_fields import Budget, cached_answer
from mdu.stages import StageResult, TextStore, _log_run

TASK = "summarize"
INDICATOR_KEYS = (
    "height_regime", "max_height_m", "pot_percent", "cut", "dwellings", "parking_spaces",
    "green_space_percent", "site_area_m2",
)  # fmt: skip


def _documents(
    cur: psycopg.Cursor[Any], store: TextStore, project_id: str
) -> list[tuple[fields.SourceDocument, str]]:
    cur.execute(
        """select distinct on (d.id) d.id::text, pd.role::text, d.text_r2_key,
               (select f.url from "fetch" f where f.raw_document_id = d.id
                order by f.fetched_at desc nulls last limit 1), d.created_at
           from project_document pd join raw_document d on d.id = pd.raw_document_id
           where pd.project_id in (select id from project where id = %s or merged_into_id = %s)
             and d.text_r2_key is not null
           order by d.id""",
        (project_id, project_id),
    )
    rows = sorted(cur.fetchall(), key=lambda r: (r[4], r[0]))
    out = []
    for doc_id, role, key, url, _ in rows:
        pages = json.loads(store.get(key)).get("pages") or []
        out.append((fields.SourceDocument(doc_id, role, [p["text"] for p in pages]), url or ""))
    return out


def header(project: dict[str, Any]) -> str:
    lines = [
        f"kind: {project['kind']}",
        f"title: {project['title']}",
        f"address: {project['address'] or '(unknown)'}",
        f"city: {project['city']}",
        f"initiator: {project['initiator'] or '(unknown)'}",
        f"designer: {project['designer'] or '(unknown)'}",
    ]
    indicators = project["indicators"] or {}
    for key in INDICATOR_KEYS:
        if key in indicators:
            lines.append(f"{key}: {indicators[key]['value']}")
    return "\n".join(lines)


def run(  # noqa: PLR0913
    conn: psycopg.Connection[Any],
    store: TextStore,
    *,
    city: str,
    writer: Any = None,  # mdu.core.llm.summary_writer() or a fake with the same interface
    monthly_usd: float = 5.0,
    log: Callable[[str], None] = lambda _: None,
) -> StageResult:
    result = StageResult()
    counts = result.counts
    row = conn.execute("select id, name from jurisdiction where slug = %s", (city,)).fetchone()
    if not row:
        raise RuntimeError(f"jurisdiction {city} missing")
    jid, city_name = int(row[0]), str(row[1])
    projects = conn.execute(
        """select id::text, kind::text, title, address_text, initiator, designer, indicators,
                  summary_ro, summary_en, indicators->'summary'
           from project where jurisdiction_id = %s and merged_into_id is null
             and review_state in ('auto_published', 'approved')
           order by id""",
        (jid,),
    ).fetchall()
    if writer is None:
        counts["summary: LLM off"] = len(projects)
        projects = []
    budget = Budget(monthly_usd)
    for pid, kind, title, address, initiator, designer, indicators, ro, en, current in projects:
        with conn.transaction(), conn.cursor() as cur:
            docs = _documents(cur, store, pid)
            selection = fields.select_pages(
                [d for d, _ in docs], summary.MAX_CHARS, read_order=fields.GROUP_READ_ORDER,
                first_page_of=fields.GROUP_FIRST_PAGE,
            )  # fmt: skip
            if not selection.pages:
                counts["no pages to read"] += 1
                continue
            facts = {
                "kind": kind, "title": title, "address": address, "city": city_name,
                "initiator": initiator, "designer": designer, "indicators": indicators,
            }  # fmt: skip
            text = summary.prompt_text(header(facts), selection)
            answer = cached_answer(
                cur, jid, task=TASK, extractor=writer, text=text,
                raw_document_id=selection.documents[0].raw_document_id, budget=budget,
                counts=counts, log=log,
            )  # fmt: skip
            if answer is None:
                continue
            names = (title, address, initiator, designer, city_name)
            allowed = " ".join(str(x or "") for x in names)
            checked = summary.check(answer, text, selection, allowed)
            if not checked.kept:
                for reason in checked.dropped:
                    counts[f"dropped: {reason}"] += 1
                continue
            assert checked.doc_index is not None
            source = selection.documents[checked.doc_index]
            urls = {d.raw_document_id: url for d, url in docs}
            provenance = {
                "value": "generated",
                "source_document_id": source.raw_document_id,
                "source_url": urls.get(source.raw_document_id, ""),
                "page": checked.page,
                "confidence": "medium",
                "model": writer.model,
                "prompt_version": writer.prompt_version,
            }
            if (ro, en, current) == (checked.ro, checked.en, provenance):
                counts["unchanged"] += 1
                continue
            cur.execute(
                """update project set summary_ro = %s, summary_en = %s,
                       indicators = jsonb_set(indicators, '{summary}', %s::jsonb),
                       updated_at = now()
                   where id = %s""",
                (checked.ro, checked.en, json.dumps(provenance, ensure_ascii=False), pid),
            )
            counts["written"] += 1
    with conn.transaction(), conn.cursor() as cur:
        _log_run(cur, jid, None, "summarize", result)
    return result
