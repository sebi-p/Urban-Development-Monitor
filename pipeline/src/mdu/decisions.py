"""Council decisions from session minutes (M5.3; ADR 0020).

An adapter reads a city's minutes into `SessionRecord`s: the session, and for each planning item
on it (PUG, PUZ, PUD) the outcome and the vote, with the page that records them. `write_session`
stores the minutes privately (they name private initiators, so the public site links to the
city's copy) and keeps the session in `council_session` and its items in `agenda_item`.

`run` (stage `decisions`, after the linker) then, for every stored item:

1. finds its project: an item a reviewer already placed keeps its project; otherwise it is scored
   against the city's projects like the linker scores two sources (plan kind, street and number,
   initiator, title words). At `linker.AUTO` and above it is placed; from `linker.REVIEW` it waits
   in `link_candidate` (subject `minutes:<agenda_item id>`), as does an item whose title is close
   to a project's when neither gives a street; otherwise an adopted or rejected plan becomes a
   project of its own, unless its title names a person or a single private home;
2. writes one `council_vote` timeline event per placed item, citing the minutes and the page;
3. sets each project's status from its latest decision (adopted -> approved, rejected, withdrawn),
   never moving a project back to an earlier procedure stage; a rejection or withdrawal doesn't
   undo an approval. A listing re-read later doesn't move it back either (`mdu.ingest`).

Minutes don't give the adopted HCL number, so none is stored here (docs/sources). Every step is
idempotent: the events are rewritten from `agenda_item` on each run.
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import psycopg

from mdu import linker
from mdu.core.documents import Upload, store_raw_document
from mdu.core.enums import AgendaOutcome, ProjectKind, ProjectStatus
from mdu.core.streets import StreetIndex, house_number, normalize
from mdu.ingest import (
    CATUC_FROM,
    DECIDED,
    PROCEDURE_STAGE,
    SourceDoc,
    _source,
    looks_personal,
    looks_private_home,
    slug_for,
)
from mdu.stages import StageResult, _log_run

SUBJECT = "minutes:"  # link_candidate subject prefix, followed by the agenda_item id
DECISION = DECIDED  # project_event details.kind of the events written here
FROM_MINUTES = "decision_project"  # details.kind of the event that created a project from minutes

STATUS_OF: dict[str, ProjectStatus] = {
    "adopted": "approved",
    "rejected": "rejected",
    "withdrawn": "withdrawn",
}
# Plans that become projects of their own when no known project matches.
NEW_PROJECT_OUTCOMES = {"adopted", "rejected"}
# Below the review score, a title this close to a known project's (with no street that disagrees,
# e.g. neither side has one) still goes to review instead of becoming a second project.
TITLE_REVIEW = 0.6


@dataclass(frozen=True)
class DecisionItem:
    number: int  # the item's number on the session's agenda
    text: str  # the draft decision's title as the minutes give it
    outcome: AgendaOutcome | None
    page: int  # 1-based page of the minutes that records the outcome
    votes_for: int | None = None
    votes_against: int | None = None
    votes_abstain: int | None = None
    votes_absent: int | None = None
    unanimous: bool = False


@dataclass(frozen=True)
class SessionRecord:
    source_ref: str  # the source's id for the minutes, e.g. "PV-468"
    session_date: date
    session_type: str | None
    source: SourceDoc
    items: list[DecisionItem] = field(default_factory=list)


def write_session(  # noqa: PLR0913
    conn: psycopg.Connection[Any],
    *,
    city: str,
    adapter: str,
    base_url: str,
    session: SessionRecord,
    upload: Upload | None,
) -> str:
    """Stores the minutes once per SHA-256 and the session with its planning items. Items keep the
    project a reviewer or an earlier run gave them. Returns the council_session id."""
    with conn.transaction(), conn.cursor() as cur:
        jid, source_id = _source(cur, city, adapter, base_url)
        src = session.source
        doc_id, _ = store_raw_document(
            cur,
            jurisdiction_id=jid,
            city=city,
            url=src.url,
            content=src.content,
            content_type=src.content_type,
            fetched_at=src.fetched_at,
            upload=upload,
            doc_type="minutes",
        )
        cur.execute(
            """insert into "fetch" (jurisdiction_id, source_id, url, status, fetched_at,
                   http_status, raw_document_id)
               values (%s, %s, %s, 'fetched', %s, %s, %s)""",
            (jid, source_id, src.url, src.fetched_at, src.status, doc_id),
        )
        cur.execute(
            """insert into council_session (jurisdiction_id, session_date, session_type,
                   source_ref, minutes_document_id)
               values (%s, %s, %s, %s, %s)
               on conflict (jurisdiction_id, source_ref) do update set
                 session_date = excluded.session_date, session_type = excluded.session_type,
                 minutes_document_id = excluded.minutes_document_id
               returning id::text""",
            (jid, session.session_date, session.session_type, session.source_ref, doc_id),
        )
        row = cur.fetchone()
        assert row
        session_id = str(row[0])
        numbers = [i.number for i in session.items]
        cur.execute(
            """delete from agenda_item where session_id = %s and item_number <> all(%s)""",
            (session_id, numbers),
        )
        for i in session.items:
            cur.execute(
                """insert into agenda_item (jurisdiction_id, session_id, item_number, item_text,
                       outcome, votes_for, votes_against, votes_abstain, votes_absent, unanimous,
                       raw_document_id, page)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   on conflict (session_id, item_number) do update set
                     item_text = excluded.item_text, outcome = excluded.outcome,
                     votes_for = excluded.votes_for, votes_against = excluded.votes_against,
                     votes_abstain = excluded.votes_abstain, votes_absent = excluded.votes_absent,
                     unanimous = excluded.unanimous, raw_document_id = excluded.raw_document_id,
                     page = excluded.page""",
                (jid, session_id, i.number, i.text, i.outcome, i.votes_for, i.votes_against,
                 i.votes_abstain, i.votes_absent, i.unanimous, doc_id, i.page),
            )  # fmt: skip
        cur.execute(
            """insert into pipeline_run
                   (jurisdiction_id, adapter, stage, status, finished_at, stats)
               values (%s, %s, 'events', 'succeeded', now(), %s)""",
            (jid, adapter, json.dumps({"session": session.source_ref, "items": len(numbers)})),
        )
    return session_id


def vote_text(item: StoredItem) -> str:
    """'unanimitate' or '16 pentru, 10 abțineri' (Romanian, like the rest of the timeline)."""
    if item.unanimous:
        return "cu unanimitate"
    parts = [
        f"{n} {label}"
        for n, label in (
            (item.votes_for, "pentru"),
            (item.votes_against, "împotrivă"),
            (item.votes_abstain, "abțineri"),
            (item.votes_absent, "nu au votat"),
        )
        if n is not None
    ]
    return ", ".join(parts)


_OUTCOME_TITLE = {
    "adopted": "Aprobat",
    "rejected": "Respins",
    "withdrawn": "Retras de pe ordinea de zi",
    "postponed": "Amânat",
}


def event_title(item: StoredItem) -> str:
    when = f"{item.session_date:%d.%m.%Y}"
    if item.outcome is None:
        return f"Pe ordinea de zi a ședinței Consiliului Local din {when}"
    title = f"{_OUTCOME_TITLE[item.outcome]} în ședința Consiliului Local din {when}"
    votes = vote_text(item) if item.outcome in ("adopted", "rejected") else ""
    return f"{title} ({votes})" if votes else title


@dataclass(frozen=True)
class StoredItem:
    id: str
    text: str
    outcome: AgendaOutcome | None
    votes_for: int | None
    votes_against: int | None
    votes_abstain: int | None
    votes_absent: int | None
    unanimous: bool
    page: int | None
    project_id: str | None
    item_number: int
    session_date: date
    session_ref: str
    raw_document_id: str | None
    url: str | None


def stored_items(conn: psycopg.Connection[Any], jid: int) -> list[StoredItem]:
    rows = conn.execute(
        """select ai.id::text, ai.item_text, ai.outcome::text, ai.votes_for, ai.votes_against,
               ai.votes_abstain, ai.votes_absent, ai.unanimous, ai.page, ai.project_id::text,
               ai.item_number, s.session_date, s.source_ref, ai.raw_document_id::text,
               (select f.url from "fetch" f where f.raw_document_id = ai.raw_document_id
                order by f.fetched_at desc nulls last limit 1)
           from agenda_item ai join council_session s on s.id = ai.session_id
           where ai.jurisdiction_id = %s
           order by s.session_date, ai.item_number""",
        (jid,),
    ).fetchall()
    return [
        StoredItem(
            id=r[0],
            text=r[1],
            outcome=r[2],
            votes_for=r[3],
            votes_against=r[4],
            votes_abstain=r[5],
            votes_absent=r[6],
            unanimous=r[7],
            page=r[8],
            project_id=r[9],
            item_number=r[10],
            session_date=r[11],
            session_ref=r[12],
            raw_document_id=r[13],
            url=r[14],
        )
        for r in rows
    ]


@dataclass(frozen=True)
class ItemFacts:
    """What the adapter reads from a stored item's text: the plan kind, its title, the initiator."""

    kind: ProjectKind
    title: str  # the plan's own name, for a project made from the item
    initiator: str | None = None  # an organisation only; None for people or when not given
    # The draft decision's title without the initiator, for matching: projects keep their
    # listing's official title, worded the same way ("Proiect de hotărâre pentru aprobarea ...").
    match_title: str | None = None


def item_profile(item: StoredItem, facts: ItemFacts, streets: StreetIndex) -> linker.Profile:
    street = streets.match(item.text) if streets else None
    number = house_number(item.text, street.name) if street else None
    return linker.Profile(
        subject=f"{SUBJECT}{item.id}",
        source="minutes",
        kind=facts.kind,
        title=facts.match_title or item.text,
        street=normalize(street.name) if street else None,
        number=number,
        initiator=facts.initiator,
        point=(street.lon, street.lat) if street else None,
        address=(f"{street.name} nr. {number}" if number else street.name) if street else None,
        title_ok=not (looks_personal(item.text) or looks_private_home(item.text)),
    )


def best_match(
    subject: linker.Profile,
    projects: list[linker.Profile],
    rejected: frozenset[tuple[str, str]],
) -> tuple[float, dict[str, Any], linker.Profile | None]:
    best: tuple[float, dict[str, Any], linker.Profile | None] = (0.0, {}, None)
    for p in projects:
        if (subject.subject, p.subject) in rejected:
            continue
        s, signals = linker.score(subject, p)
        if s > best[0]:
            best = (s, signals, p)
    return best


def decide(
    profile: linker.Profile,
    projects: list[linker.Profile],
    rejected: frozenset[tuple[str, str]],
    outcome: str | None,
) -> tuple[str, linker.Profile | None, float, dict[str, Any]]:
    """Pure: "place" on a project, "review" against one, "new" project, or "none"."""
    score, signals, target = best_match(profile, projects, rejected)
    if target is not None and score >= linker.AUTO:
        return "place", target, score, signals
    if target is not None and score >= linker.REVIEW:
        return "review", target, score, signals
    close = float(signals.get("title", 0)) >= TITLE_REVIEW
    if target is not None and close and signals.get("street") in (None, profile.street):
        return "review", target, score, signals
    if outcome in NEW_PROJECT_OUTCOMES and profile.title_ok:
        return "new", None, score, signals
    return "none", None, score, signals


def _new_project(
    cur: psycopg.Cursor[Any], jid: int, item: StoredItem, profile: linker.Profile, title: str
) -> str:
    assert profile.kind
    status = STATUS_OF[item.outcome or "adopted"]
    geom = "ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)" if profile.point else "NULL"
    cur.execute(
        f"""insert into project (jurisdiction_id, slug, kind, status, title, address_text, geom,
                geom_precision, legal_regime, review_state)
            values (%(jid)s, %(slug)s, %(kind)s, %(status)s, %(title)s, %(address)s, {geom},
                %(precision)s, %(regime)s, 'auto_published')
            on conflict (jurisdiction_id, slug) do update set title = excluded.title
            returning id::text""",
        {"jid": jid, "slug": slug_for(title, profile.subject), "kind": profile.kind,
         "status": status, "title": title, "address": profile.address,
         "lon": profile.point[0] if profile.point else None,
         "lat": profile.point[1] if profile.point else None,
         "precision": "street" if profile.point else None,
         "regime": "catuc" if item.session_date >= CATUC_FROM else "pre_catuc"},
    )  # fmt: skip
    row = cur.fetchone()
    assert row
    pid = str(row[0])
    cur.execute(
        "delete from project_event where project_id = %s and details->>'kind' = %s",
        (pid, FROM_MINUTES),
    )
    cur.execute(
        """insert into project_event (jurisdiction_id, project_id, event_date, event_type,
               raw_document_id, title, details, confidence, review_state)
           values (%s, %s, %s, 'council_agenda', %s, %s, %s, 'medium', 'auto_published')""",
        (jid, pid, item.session_date, item.raw_document_id,
         f"Pe ordinea de zi a ședinței Consiliului Local din {item.session_date:%d.%m.%Y}",
         json.dumps({"source": "decisions", "kind": FROM_MINUTES, "official_title": item.text,
                     "source_url": _cite(item)}, ensure_ascii=False)),
    )  # fmt: skip
    return pid


def _cite(item: StoredItem) -> str | None:
    if not item.url:
        return None
    return f"{item.url}#page={item.page}" if item.page else item.url


def _candidate(  # noqa: PLR0913
    cur: psycopg.Cursor[Any],
    jid: int,
    subject: str,
    project_id: str,
    *,
    score: float,
    signals: dict[str, Any],
    state: str,
) -> None:
    cur.execute(
        """insert into link_candidate (jurisdiction_id, subject, candidate_project_id, score,
               signals, state, decided_at)
           values (%s, %s, %s, %s, %s, %s, case when %s = 'auto_published' then now() end)
           on conflict (jurisdiction_id, subject, candidate_project_id) do update
             set score = excluded.score, signals = excluded.signals""",
        (jid, subject, project_id, score, json.dumps(signals, ensure_ascii=False), state, state),
    )


def place_items(  # noqa: PLR0913
    conn: psycopg.Connection[Any],
    jid: int,
    items: list[StoredItem],
    *,
    facts: Callable[[str], ItemFacts],
    streets: StreetIndex,
    counts: Counter[str],
) -> None:
    """Step 1: gives each unplaced item a project, a review candidate, or a new project."""
    candidates = conn.execute(
        """select subject, candidate_project_id::text, state::text from link_candidate
           where jurisdiction_id = %s and subject like %s""",
        (jid, f"{SUBJECT}%"),
    ).fetchall()
    rejected = frozenset((s, f"project:{c}") for s, c, st in candidates if st == "rejected")
    waiting = {s for s, _, st in candidates if st == "pending_review"}
    projects = linker.project_profiles(conn, jid, streets)
    for item in items:
        if item.project_id is not None:
            continue
        subject = f"{SUBJECT}{item.id}"
        if subject in waiting:
            counts["waiting for review"] += 1
            continue
        known = facts(item.text)
        profile = item_profile(item, known, streets)
        action, target, score, signals = decide(profile, projects, rejected, item.outcome)
        with conn.transaction(), conn.cursor() as cur:
            if action in ("place", "review"):
                assert target is not None
                assert target.project_id
                state = "auto_published" if action == "place" else "pending_review"
                _candidate(
                    cur, jid, subject, target.project_id, score=score, signals=signals, state=state
                )
                if action == "place":
                    _place(cur, item.id, target.project_id)
                counts["placed" if action == "place" else "for review"] += 1
            elif action == "new" and known.title:
                pid = _new_project(cur, jid, item, profile, known.title)
                _place(cur, item.id, pid)
                counts["new projects"] += 1
            else:
                counts["unplaced"] += 1


def _place(cur: psycopg.Cursor[Any], item_id: str, project_id: str) -> None:
    cur.execute("update agenda_item set project_id = %s where id = %s", (project_id, item_id))


def write_events(conn: psycopg.Connection[Any], jid: int, counts: Counter[str]) -> None:
    """Step 2: one timeline event per placed item, rewritten from agenda_item each run."""
    items = [i for i in stored_items(conn, jid) if i.project_id is not None]
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """delete from project_event where jurisdiction_id = %s and details->>'kind' = %s""",
            (jid, DECISION),
        )
        for i in items:
            details = {
                "source": "decisions", "kind": DECISION, "outcome": i.outcome,
                "session": i.session_ref, "item": i.item_number, "page": i.page,
                "votes": {"for": i.votes_for, "against": i.votes_against,
                          "abstain": i.votes_abstain, "absent": i.votes_absent,
                          "unanimous": i.unanimous},
                "source_url": _cite(i),
            }  # fmt: skip
            cur.execute(
                """insert into project_event (jurisdiction_id, project_id, event_date, event_type,
                       raw_document_id, title, details, confidence, review_state)
                   values (%s, %s, %s, %s, %s, %s, %s, 'high', 'auto_published')""",
                (jid, i.project_id, i.session_date,
                 "council_agenda" if i.outcome in (None, "postponed") else "council_vote",
                 i.raw_document_id, event_title(i), json.dumps(details, ensure_ascii=False)),
            )  # fmt: skip
            counts["events"] += 1


def next_status(current: str, outcome: str) -> ProjectStatus | None:
    """The status a decision gives a project, or None to keep its own. An adoption applies unless
    the project is already further on (permitted, built); a rejection or a withdrawal only to a
    project the council hasn't decided yet: it can concern a later change to an approved plan, and
    an adoption the matcher left for review may follow it."""
    new = STATUS_OF.get(outcome)
    if new is None or new == current:
        return None
    now, then = PROCEDURE_STAGE.get(current, 0), PROCEDURE_STAGE.get(new, 0)
    if then < now or (outcome != "adopted" and then == now):
        return None
    return new


def apply_statuses(conn: psycopg.Connection[Any], jid: int, counts: Counter[str]) -> None:
    """Step 3: each project takes the status of its family's latest decision (`next_status`)."""
    rows = conn.execute(
        """select distinct on (p.id) p.id::text, p.status::text, e.details->>'outcome'
           from project p
           join project c on c.id = p.id or c.merged_into_id = p.id
           join project_event e on e.project_id = c.id and e.details->>'kind' = %s
           where p.jurisdiction_id = %s and p.merged_into_id is null
             and e.details->>'outcome' = any(%s)
           order by p.id, e.event_date desc, (e.details->>'item')::int desc""",
        (DECISION, jid, list(STATUS_OF)),
    ).fetchall()
    with conn.transaction(), conn.cursor() as cur:
        for pid, current, outcome in rows:
            new = next_status(current, outcome)
            if new is None:
                counts["status kept" if STATUS_OF[outcome] != current else "status unchanged"] += 1
                continue
            cur.execute(
                "update project set status = %s, updated_at = now() where id = %s", (new, pid)
            )
            counts[f"status -> {new}"] += 1


def run(
    conn: psycopg.Connection[Any],
    *,
    city: str,
    streets: StreetIndex,
    facts: Callable[[str], ItemFacts],
    log: Callable[[str], None] = lambda _: None,
) -> StageResult:
    """Places the stored minutes items, writes their events and sets the statuses."""
    del log
    result = StageResult()
    row = conn.execute("select id from jurisdiction where slug = %s", (city,)).fetchone()
    if not row:
        raise RuntimeError(f"jurisdiction {city} missing")
    jid = int(row[0])
    place_items(
        conn, jid, stored_items(conn, jid), facts=facts, streets=streets, counts=result.counts
    )
    write_events(conn, jid, result.counts)
    apply_statuses(conn, jid, result.counts)
    with conn.transaction(), conn.cursor() as cur:
        _log_run(cur, jid, None, "decisions", result)
    return result
