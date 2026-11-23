"""Consult stage (M4.2): one `consultation` row per notice linked to a project.

Reads each linked notice ("anunt") from R2, asks the consult reader for the dates and how to
submit comments (`mdu.core.consult`), and upserts the checked values on (project, notice). The
answers are cached in `extraction_run` (task `extract_consultation`), so a notice is sent to the
model once; re-running the stage changes nothing.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import psycopg

from mdu.core import consult
from mdu.project_fields import Budget, cached_answer
from mdu.stages import StageResult, TextStore, _log_run

TASK = "extract_consultation"


def _row(found: consult.Consultation, tz: ZoneInfo) -> dict[str, Any]:
    v = found.values

    def get(name: str) -> Any:
        return v[name].value if name in v else None

    meeting = get("public_meeting_at")
    return {
        "opens_on": get("opens_on"),
        "closes_on": get("closes_on"),
        "submit_email": get("submit_email"),
        "submit_address": get("submit_address"),
        "submit_instructions": get("submit_instructions"),
        "public_meeting_at": meeting.replace(tzinfo=tz) if isinstance(meeting, datetime) else None,
        "public_meeting_place": get("public_meeting_place"),
        "page": found.page,
    }


def run(  # noqa: PLR0913
    conn: psycopg.Connection[Any],
    store: TextStore,
    *,
    city: str,
    reader: Any = None,  # mdu.core.llm.consult_reader() or a fake with the same interface
    monthly_usd: float = 5.0,
    log: Callable[[str], None] = lambda _: None,
) -> StageResult:
    result = StageResult()
    counts = result.counts
    row = conn.execute("select id, timezone from jurisdiction where slug = %s", (city,)).fetchone()
    if not row:
        raise RuntimeError(f"jurisdiction {city} missing")
    jid, tz = int(row[0]), ZoneInfo(row[1] or "UTC")
    notices = conn.execute(
        """select distinct pd.project_id::text, d.id::text, d.text_r2_key
           from project_document pd join raw_document d on d.id = pd.raw_document_id
           where pd.jurisdiction_id = %s and pd.role = 'anunt' and d.text_r2_key is not null
           order by 1, 2""",
        (jid,),
    ).fetchall()
    if reader is None:
        counts["consult: LLM off"] = len(notices)
        notices = []
    budget = Budget(monthly_usd)
    for project_id, doc_id, key in notices:
        with conn.transaction(), conn.cursor() as cur:
            pages = [p["text"] for p in json.loads(store.get(key)).get("pages") or []]
            text = consult.prompt_text(pages)
            if not text:
                counts["no text"] += 1
                continue
            answer = cached_answer(
                cur, jid, task=TASK, extractor=reader, text=text, raw_document_id=doc_id,
                budget=budget, counts=counts, log=log,
            )  # fmt: skip
            if answer is None:
                continue
            found = consult.check(answer, pages)
            for name, reason in found.dropped.items():
                counts[f"dropped {name}: {reason}"] += 1
            if not found.found:
                counts["no dates in the notice"] += 1
                continue
            values = _row(found, tz)
            details = {
                "values": {
                    k: {"page": kept.page, "quote": kept.quote} for k, kept in found.values.items()
                },
                "model": reader.model,
                "prompt_version": reader.prompt_version,
                "confidence": "medium",
            }
            cur.execute(
                """insert into consultation (jurisdiction_id, project_id, raw_document_id,
                       opens_on, closes_on, submit_email, submit_address, submit_instructions,
                       public_meeting_at, public_meeting_place, page, details)
                   values (%(jid)s, %(project)s, %(doc)s, %(opens_on)s, %(closes_on)s,
                       %(submit_email)s, %(submit_address)s, %(submit_instructions)s,
                       %(public_meeting_at)s, %(public_meeting_place)s, %(page)s, %(details)s)
                   on conflict (project_id, raw_document_id) do update set
                       opens_on = excluded.opens_on, closes_on = excluded.closes_on,
                       submit_email = excluded.submit_email,
                       submit_address = excluded.submit_address,
                       submit_instructions = excluded.submit_instructions,
                       public_meeting_at = excluded.public_meeting_at,
                       public_meeting_place = excluded.public_meeting_place,
                       page = excluded.page, details = excluded.details
                   where (consultation.opens_on, consultation.closes_on,
                          consultation.submit_email, consultation.submit_address,
                          consultation.submit_instructions, consultation.public_meeting_at,
                          consultation.public_meeting_place, consultation.page,
                          consultation.details)
                       is distinct from (excluded.opens_on, excluded.closes_on,
                          excluded.submit_email, excluded.submit_address,
                          excluded.submit_instructions, excluded.public_meeting_at,
                          excluded.public_meeting_place, excluded.page, excluded.details)""",
                {**values, "jid": jid, "project": project_id, "doc": doc_id,
                 "details": json.dumps(details, ensure_ascii=False)},
            )  # fmt: skip
            counts["consultations written" if cur.rowcount else "consultations unchanged"] += 1
    with conn.transaction(), conn.cursor() as cur:
        _log_run(cur, jid, None, "consult", result)
    return result
