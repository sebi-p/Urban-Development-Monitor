"""Council minutes -> council sessions and their planning decisions (M5.3; ADR 0020).

Each run reads the listing (the 18 newest minutes) and stores the minutes it hasn't stored yet,
then walks older numbers (`CMBV-PV-<n>` is sequential) down to the first session of
`HISTORY_FROM`, at most `PER_RUN` files a run. Numbers without a PDF (some are skipped) and PDFs
without a text layer are passed over. The same PDF published under two numbers is stored once.
Placing the decisions on projects is the `decisions` stage (`mdu.decisions`), after the linker.
"""

from collections import Counter
from datetime import date
from typing import Any

import psycopg

from mdu.adapters.brasov import council_minutes
from mdu.core.documents import Upload
from mdu.core.extract import ExtractionError, raw_page_texts
from mdu.core.http import HttpError, PoliteClient
from mdu.core.streets import StreetIndex
from mdu.decisions import DecisionItem, ItemFacts, SessionRecord, write_session
from mdu.ingest import SourceDoc

KEY = "brasov.council_minutes"
HISTORY_FROM = date(2020, 1, 1)  # PLAN §10: launch with 2020-present
PER_RUN = 40  # older minutes fetched per run (about 180 since 2020: a few days)
MAX_MISSING = 15  # numbers in a row without a PDF before the walk stops


def facts(text: str) -> ItemFacts:
    """The `decisions` stage's view of a stored item: plan kind, plan title, initiator."""
    kind = council_minutes.kind_of(text) or "puz"
    return ItemFacts(
        kind=kind,
        title=council_minutes.plan_title(text),
        initiator=council_minutes.initiator(text),
        match_title=council_minutes.without_initiator(text),
    )


def session_record(number: int, source: SourceDoc, listed: date | None) -> SessionRecord | None:
    """Pure: one fetched minutes PDF -> its session and planning items (None without text)."""
    try:
        pages = raw_page_texts(source.content)
    except ExtractionError:
        return None
    minutes = council_minutes.parse_minutes(pages)
    session_date = minutes.session_date or listed
    if not minutes.has_text or session_date is None:
        return None
    return SessionRecord(
        source_ref=council_minutes.source_ref(number),
        session_date=session_date,
        session_type=minutes.session_type,
        source=source,
        items=[
            DecisionItem(
                number=i.number,
                text=i.text,
                outcome=i.vote.outcome,
                page=i.page,
                votes_for=i.vote.votes_for,
                votes_against=i.vote.votes_against,
                votes_abstain=i.vote.votes_abstain,
                votes_absent=i.vote.votes_absent,
                unanimous=i.vote.unanimous,
            )
            for i in minutes.items
        ],
    )


def _stored(conn: psycopg.Connection[Any]) -> tuple[dict[int, date], set[str]]:
    rows = conn.execute(
        """select s.source_ref, s.session_date, d.sha256 from council_session s
           join jurisdiction j on j.id = s.jurisdiction_id
           left join raw_document d on d.id = s.minutes_document_id
           where j.slug = 'brasov' and s.source_ref like 'PV-%%'"""
    ).fetchall()
    numbers = {int(ref.removeprefix("PV-")): day for ref, day, _ in rows}
    return numbers, {sha for _, _, sha in rows if sha}


def minutes_events(
    conn: psycopg.Connection[Any],
    client: PoliteClient,
    upload: Upload | None,
    streets: StreetIndex,
) -> Counter[str]:
    del streets  # matching is the decisions stage's job
    counts: Counter[str] = Counter()
    resp = client.get(council_minutes.LISTING_URL)
    if resp.status != 200:  # noqa: PLR2004
        raise HttpError(f"minutes listing returned HTTP {resp.status}")
    listed = {m.number: m.session_date for m in council_minutes.parse_listing(resp.content)}
    stored, hashes = _stored(conn)
    todo = sorted((n for n in listed if n not in stored), reverse=True)
    known = set(stored) | set(listed)
    reached = any(day < HISTORY_FROM for day in stored.values())
    walk_from = min(known) - 1 if known else 0

    def take(number: int) -> date | None:
        """Fetches and stores one number; returns its session date, or None if nothing there."""
        r = client.get(council_minutes.minutes_url(number))
        if r.status != 200 or not r.content.startswith(b"%PDF"):  # noqa: PLR2004
            counts["no PDF"] += 1
            return None
        source = SourceDoc(r.url, r.status, r.content, r.content_type)
        if source.sha256 in hashes:
            counts["same PDF as another number"] += 1
            return None
        session = session_record(number, source, listed.get(number))
        if session is None:
            counts["no text layer"] += 1
            return None
        write_session(
            conn, city="brasov", adapter=KEY, base_url=council_minutes.LISTING_URL,
            session=session, upload=upload,
        )  # fmt: skip
        hashes.add(source.sha256)
        counts["minutes"] += 1
        counts["planning items"] += len(session.items)
        return session.session_date

    for number in todo:
        take(number)
    missing, n, budget = 0, walk_from, PER_RUN
    while not reached and n > 0 and budget > 0 and missing < MAX_MISSING:
        day = take(n)
        budget -= 1
        missing = missing + 1 if day is None else 0
        reached = day is not None and day < HISTORY_FROM
        n -= 1
    counts["history reached"] = int(reached)
    return counts
