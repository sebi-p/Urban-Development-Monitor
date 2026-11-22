"""Stages 5 (part) and 6 (part): link documents to projects and extract project fields (M3.2).

- `link_documents` attaches stored documents to the project whose listing names their URL, with
  the classified type as the role (`project_document`). Registers of comments are never linked.
- `extract_fields` reads each project's linked documents from R2, finds identifiers (CU, CF,
  cadastral numbers) by regular expression, and asks the field extractor for the indicators,
  initiator and designer. Only checked values are written (`mdu.core.fields.check`). Answers are
  cached in `extraction_run` by input hash, prompt version and model, so a project is sent to the
  model again only when its documents change; a monthly budget caps the spend.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import psycopg

from mdu.core import fields
from mdu.core.identifiers import find_identifiers
from mdu.stages import StageResult, TextStore, _log_run, _month_spend


def link_documents(conn: psycopg.Connection[Any], city: str) -> Counter[str]:
    counts: Counter[str] = Counter()
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """with listed as (
                 select distinct p.jurisdiction_id, p.id as project_id, d.id as doc_id, d.doc_type
                 from project p
                 join jurisdiction j on j.id = p.jurisdiction_id and j.slug = %s
                 join project_event e on e.project_id = p.id and e.details ? 'documents'
                 join lateral jsonb_array_elements(e.details->'documents') doc on true
                 join "fetch" f on f.url = doc->>'url' and f.raw_document_id is not null
                 join raw_document d on d.id = f.raw_document_id
                 where d.doc_type is not null and d.doc_type <> 'registru_opinii'
               ), stale as (
                 delete from project_document pd using listed l
                 where pd.project_id = l.project_id and pd.raw_document_id = l.doc_id
                   and pd.role::text <> l.doc_type
                 returning 1
               )
               insert into project_document (jurisdiction_id, project_id, raw_document_id, role)
               select jurisdiction_id, project_id, doc_id, doc_type::document_role from listed
               on conflict do nothing""",
            (city,),
        )
        counts["linked"] = cur.rowcount
    return counts


def _documents(
    cur: psycopg.Cursor[Any], store: TextStore, project_id: str
) -> list[tuple[fields.SourceDocument, str]]:
    cur.execute(
        """select d.id::text, pd.role::text, d.text_r2_key,
               (select f.url from "fetch" f where f.raw_document_id = d.id
                order by f.fetched_at desc nulls last limit 1)
           from project_document pd join raw_document d on d.id = pd.raw_document_id
           where pd.project_id = %s and d.text_r2_key is not null
           order by d.created_at, d.id""",
        (project_id,),
    )
    out = []
    for doc_id, role, key, url in cur.fetchall():
        pages = json.loads(store.get(key)).get("pages") or []
        out.append((fields.SourceDocument(doc_id, role, [p["text"] for p in pages]), url or ""))
    return out


def _indicators(checked: fields.Checked, urls: dict[str, str]) -> dict[str, Any]:
    return {
        v.field: {
            "value": v.value,
            "source_document_id": v.raw_document_id,
            "source_url": urls.get(v.raw_document_id, ""),
            "page": v.page,
            "confidence": "medium",  # extracted automatically; the quote was found on the page
        }
        for v in checked.kept
        if v.field not in ("initiator", "designer", "title", "address")
    }


@dataclass
class Budget:
    monthly_usd: float
    reached: bool = False


def fields_answer(  # noqa: PLR0913
    cur: psycopg.Cursor[Any],
    jid: int,
    *,
    extractor: Any,
    selection: fields.Selection,
    budget: Budget,
    counts: Counter[str],
    log: Callable[[str], None],
) -> dict[str, Any] | None:
    """The extractor's answer for these pages: from the `extraction_run` cache, or a new call
    within the monthly budget (logged there). None when the call failed or the budget is spent;
    the caller retries on a later run."""
    from mdu.core.llm import LlmError  # noqa: PLC0415

    text = selection.prompt_text()
    input_hash = hashlib.sha256(
        f"{extractor.prompt_version}\n{extractor.model}\n{text}".encode()
    ).hexdigest()
    cur.execute(
        """select output from extraction_run where task = 'extract_fields'
             and input_hash = %s and prompt_version = %s and model = %s""",
        (input_hash, extractor.prompt_version, extractor.model),
    )
    cached = cur.fetchone()
    if cached:
        counts["cached"] += 1
        return dict(cached[0])
    if budget.reached or _month_spend(cur, jid) >= budget.monthly_usd:
        if not budget.reached:
            log(f"fields: LLM budget of ${budget.monthly_usd:.2f} this month reached")
        budget.reached = True
        counts["deferred: LLM budget"] += 1
        return None
    try:
        reply = extractor(text)
    except LlmError as exc:
        log(f"fields: LLM failed ({exc})")
        counts["deferred: LLM error"] += 1
        return None
    cur.execute(
        """insert into extraction_run (jurisdiction_id, raw_document_id, task, model,
               prompt_version, input_hash, output, input_tokens, output_tokens, cost_usd)
           values (%s, %s, 'extract_fields', %s, %s, %s, %s, %s, %s, %s)
           on conflict (input_hash, prompt_version, model) do nothing""",
        (jid, selection.documents[0].raw_document_id, extractor.model, extractor.prompt_version,
         input_hash, json.dumps(reply.data, ensure_ascii=False), reply.input_tokens,
         reply.output_tokens, reply.cost_usd),
    )  # fmt: skip
    counts["llm_calls"] += 1
    return dict(reply.data)


def extract_fields(  # noqa: PLR0913
    conn: psycopg.Connection[Any],
    store: TextStore,
    *,
    city: str,
    extractor: Any = None,  # mdu.core.llm.ClaudeFieldExtractor or a fake with the same interface
    monthly_usd: float = 2.0,
    limit: int = 200,
    log: Callable[[str], None] = lambda _: None,
) -> StageResult:

    result = StageResult()
    result.counts.update(link_documents(conn, city))
    with conn.cursor() as cur:
        cur.execute("select id from jurisdiction where slug = %s", (city,))
        j = cur.fetchone()
        if not j:
            raise RuntimeError(f"jurisdiction {city} missing")
        jid = int(j[0])
        cur.execute(
            """select distinct p.id::text from project p
               join project_document pd on pd.project_id = p.id
               where p.jurisdiction_id = %s order by 1 limit %s""",
            (jid, limit),
        )
        project_ids = [r[0] for r in cur.fetchall()]
    budget_reached = False
    for project_id in project_ids:
        with conn.transaction(), conn.cursor() as cur:
            docs = _documents(cur, store, project_id)
            urls = {d.raw_document_id: url for d, url in docs}
            # Identifiers from every page of every linked document.
            for doc, _ in docs:
                for found in find_identifiers(doc.pages):
                    cur.execute(
                        """insert into identifier (jurisdiction_id, project_id, scheme, value,
                               issued_on, raw_document_id)
                           values (%s, %s, %s, %s, %s, %s)
                           on conflict (jurisdiction_id, scheme, value) do nothing""",
                        (jid, project_id, found.scheme, found.value, found.issued_on,
                         doc.raw_document_id),
                    )  # fmt: skip
                    result.counts["identifiers new"] += cur.rowcount
            selection = fields.select_pages([d for d, _ in docs])
            if not selection.pages or extractor is None:
                result.counts["no pages to read" if extractor else "fields: LLM off"] += 1
                continue
            budget = Budget(monthly_usd, reached=budget_reached)
            answer = fields_answer(
                cur, jid, extractor=extractor, selection=selection, budget=budget,
                counts=result.counts, log=log,
            )  # fmt: skip
            budget_reached = budget.reached
            if answer is None:
                continue
            checked = fields.check(answer, selection)
            kept = {v.field: v.value for v in checked.kept}
            cur.execute(
                """update project set indicators = %s, initiator = %s::text, designer = %s::text,
                       updated_at = now()
                   where id = %s and (indicators, initiator, designer)
                       is distinct from (%s::jsonb, %s::text, %s::text)""",
                (json.dumps(_indicators(checked, urls), ensure_ascii=False),
                 kept.get("initiator"), kept.get("designer"), project_id,
                 json.dumps(_indicators(checked, urls), ensure_ascii=False),
                 kept.get("initiator"), kept.get("designer")),
            )  # fmt: skip
            result.counts["projects updated" if cur.rowcount else "projects unchanged"] += 1
            result.counts["values kept"] += len(checked.kept)
            for reason in checked.dropped.values():
                result.counts[f"dropped: {reason}"] += 1
    with conn.transaction(), conn.cursor() as cur:
        _log_run(cur, jid, None, "extract_fields", result)
    return result
