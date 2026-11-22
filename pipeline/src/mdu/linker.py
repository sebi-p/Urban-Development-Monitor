"""Linker (PLAN §7 stage 6, M3.3; ADR 0010).

Subjects are projects (from listings) and groups of documents that belong to no project yet (a
hub folder, known only by a hash of its name). Each gets a profile: title, street and number,
initiator, identifiers (CU, CF, cadastral) and location. Every pair is scored:

- a shared CU number (+0.6) or CF/cadastral number (+0.5), the same street (+0.45) and house
  number (+0.2; a different number -0.3), similar titles (up to +0.3) and the same initiator
  (+0.2; a different company -0.2) add up. An identifier alone isn't enough: documents also cite
  other plans' certificates and neighbouring parcels;
- different plan kinds (PUD vs PUZ) never match, and a different street or a distance over 1 km
  caps the score below the review threshold.

At `AUTO` and above the link is applied: a document group is attached to the project, and of two
projects the one at the earlier procedure stage is merged into the other (`merged_into_id`; it
stays so its source keeps updating it, but is hidden). From `REVIEW` to `AUTO` the pair waits in
`link_candidate`. A document group that matches nothing becomes a new project, titled from its
documents, unless the title names a person or a single private home (PLAN §11).
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import psycopg

from mdu.core import fields
from mdu.core.identifiers import find_identifiers
from mdu.core.streets import StreetIndex, fold, house_number, normalize
from mdu.ingest import looks_personal, looks_private_home, slug_for
from mdu.project_fields import Budget, fields_answer
from mdu.stages import StageResult, TextStore, _log_run

AUTO = 0.85
REVIEW = 0.6
LINKER_VERSION = "linker-1"

# Procedure stage, for the direction of a merge: the later stage absorbs the earlier one.
STAGE = {
    "announced": 0, "in_preparation": 1, "in_public_consultation": 2, "under_committee_review": 3,
    "expired": 3, "on_council_agenda": 4, "approved": 5, "rejected": 5, "withdrawn": 5,
    "permitted": 6, "under_construction": 7, "completed": 8, "contested": 6, "annulled": 6,
}  # fmt: skip

_STOP = {
    "puz", "pud", "plan", "urbanistic", "zonal", "detaliu", "de", "si", "cu", "in", "pentru",
    "privind", "aprobarea", "documentatiei", "urbanism", "intocmire", "construire", "str", "strada",
    "municipiul", "mun", "brasov", "nr", "fn", "f", "n", "jud", "judetul", "a", "al", "la", "din",
}  # fmt: skip


@dataclass
class Profile:
    subject: str  # "project:<uuid>" or "group:<adapter>:<hash>"
    source: str
    kind: str | None
    title: str
    street: str | None = None  # normalised street name
    number: str | None = None
    initiator: str | None = None  # an organisation's normalised name; None for people/unknown
    identifiers: frozenset[tuple[str, str]] = frozenset()
    point: tuple[float, float] | None = None
    project_id: str | None = None
    stage: int = 0
    first_seen: datetime | None = None
    # Document groups only:
    documents: list[tuple[str, str, str, int | None]] = field(default_factory=list)
    address: str | None = None
    title_ok: bool = True  # False when the title names a person or a single private home


def title_words(title: str) -> set[str]:
    words = re.sub(r"[^a-z0-9 ]", " ", fold(title)).split()
    return {w for w in words if w not in _STOP and len(w) > 1}


def _org(name: str | None) -> str | None:
    if not name or fold(name).startswith("persoan"):
        return None
    s = re.sub(
        r"\bs\.?\s?c\.?\b|\bs\.?\s?r\.?\s?l\.?\b|\bs\.?\s?a\.?\b|\bs\.?c\.?s\b", " ", fold(name)
    )
    return re.sub(r"[^a-z0-9]+", " ", s).strip() or None


def _km(a: tuple[float, float], b: tuple[float, float]) -> float:
    dx = (a[0] - b[0]) * 111.32 * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot(dx, (a[1] - b[1]) * 110.57)


def score(a: Profile, b: Profile) -> tuple[float, dict[str, Any]]:
    if a.kind and b.kind and a.kind != b.kind:
        return 0.0, {"kind": f"{a.kind} vs {b.kind}"}
    total = 0.0
    signals: dict[str, Any] = {}
    # A shared identifier is strong evidence but not proof: documents also cite other plans'
    # certificates and neighbouring parcels.
    shared = sorted(a.identifiers & b.identifiers)
    if shared:
        cu = [v for s, v in shared if s == "cu"]
        total += 0.6 if cu else 0.5
        signals["identifier"] = f"cu {cu[0]}" if cu else f"{shared[0][0]} {shared[0][1]}"
    cap = 1.0
    if a.street and b.street:
        if a.street == b.street:
            total += 0.45
            signals["street"] = a.street
        else:
            cap = REVIEW - 0.1
            signals["street"] = "different"
    if a.number and b.number:
        if a.number == b.number:
            total += 0.2
            signals["number"] = a.number
        else:
            total -= 0.3
            signals["number"] = f"{a.number} vs {b.number}"
    wa, wb = title_words(a.title), title_words(b.title)
    if wa and wb:
        sim = len(wa & wb) / len(wa | wb)
        total += 0.3 * sim
        signals["title"] = round(sim, 2)
    oa, ob = _org(a.initiator), _org(b.initiator)
    if oa and ob:
        same = oa in ob or ob in oa
        total += 0.2 if same else -0.2
        signals["initiator"] = "same" if same else "different"
    if a.point and b.point and _km(a.point, b.point) > 1.0:
        cap = min(cap, REVIEW - 0.1)
        signals["distance_km"] = round(_km(a.point, b.point), 1)
    return round(max(0.0, min(total, cap)), 3), signals


@dataclass(frozen=True)
class Decision:
    subject: Profile
    target: Profile | None  # None: a new project (groups) or nothing to do (projects)
    score: float
    signals: dict[str, Any]
    action: str  # "merge", "attach", "review", "new", "none"


def decide(
    profiles: list[Profile], rejected: frozenset[tuple[str, str]] = frozenset()
) -> list[Decision]:
    """Pure: for each subject, its best match among the projects. Projects are compared pairwise
    once; the earlier-stage project of a pair is the subject. Pairs a reviewer rejected
    (subject, candidate subject) are left out, so a folder can still join another project or
    become its own."""
    projects = [p for p in profiles if p.project_id]
    groups = [p for p in profiles if not p.project_id]
    decisions: list[Decision] = []
    for g in groups:
        scored = sorted(
            ((score(g, p), p) for p in projects if (g.subject, p.subject) not in rejected),
            key=lambda x: -x[0][0],
        )
        if scored and scored[0][0][0] >= REVIEW:
            (s, sig), target = scored[0]
            decisions.append(Decision(g, target, s, sig, "attach" if s >= AUTO else "review"))
        else:
            decisions.append(Decision(g, None, scored[0][0][0] if scored else 0.0, {}, "new"))
    pairs = []
    for i, a in enumerate(projects):
        for b in projects[i + 1 :]:
            if (a.subject, b.subject) in rejected or (b.subject, a.subject) in rejected:
                continue
            s, sig = score(a, b)
            if s >= REVIEW:
                early, late = sorted(
                    (a, b),
                    key=lambda p: (
                        p.stage,
                        -(p.first_seen or datetime.max.replace(tzinfo=UTC)).timestamp(),
                    ),
                )
                pairs.append(Decision(early, late, s, sig, "merge" if s >= AUTO else "review"))
    decisions += sorted(pairs, key=lambda d: -d.score)
    return decisions


# Profiles from the database


def project_profiles(
    conn: psycopg.Connection[Any], jid: int, streets: StreetIndex
) -> list[Profile]:
    rows = conn.execute(
        """select p.id::text, p.kind::text, p.status::text, p.title, p.address_text, p.initiator,
               ST_X(p.geom), ST_Y(p.geom), p.first_seen_at,
               (select e.details->>'official_title' from project_event e
                where e.project_id = p.id and e.details ? 'official_title' limit 1),
               (select e.details->>'source' from project_event e
                where e.project_id = p.id and e.details->>'kind' = 'listing' limit 1),
               coalesce((select array_agg(i.scheme::text || ':' || i.value) from identifier i
                         where i.project_id = p.id), '{}')
           from project p
           where p.jurisdiction_id = %s and p.merged_into_id is null""",
        (jid,),
    ).fetchall()
    out = []
    for pid, kind, status, title, address, initiator, x, y, seen, official, source, ids in rows:
        street = streets.match(address or official or title) if streets else None
        out.append(
            Profile(
                subject=f"project:{pid}",
                source=source or "",
                kind=kind,
                title=official or title,
                street=normalize(street.name) if street else None,
                number=house_number(address or "", street.name) if street and address else None,
                initiator=initiator,
                identifiers=frozenset((i.split(":", 1)[0], i.split(":", 1)[1]) for i in ids),
                point=(x, y) if x is not None else None,
                project_id=pid,
                stage=STAGE.get(status, 0),
                first_seen=seen,
            )
        )
    return out


def unlinked_groups(conn: psycopg.Connection[Any], jid: int) -> dict[tuple[str, str], list[Any]]:
    """Documents discovered with a `group` hint (a hub folder) and a plan kind, by group."""
    rows = conn.execute(
        """select s.adapter, f.hints->>'group', f.hints->>'kind', d.id::text, d.doc_type,
               d.text_r2_key, f.url, (f.hints->>'size_bytes')::bigint, f.fetched_at,
               (select pd.project_id::text from project_document pd
                where pd.raw_document_id = d.id limit 1)
           from "fetch" f join source s on s.id = f.source_id
           join raw_document d on d.id = f.raw_document_id
           where f.jurisdiction_id = %s and f.hints ? 'group'
             and f.hints->>'kind' in ('pud', 'puz')
             and d.text_r2_key is not null and d.doc_type is not null
             and d.doc_type <> 'registru_opinii'
           order by f.fetched_at""",
        (jid,),
    ).fetchall()
    groups: dict[tuple[str, str], list[Any]] = {}
    for adapter, group, *rest in rows:
        groups.setdefault((adapter, group), []).append(rest)
    return groups


def _known_project(rows: list[Any]) -> str | None:
    """The project a group's files already belong to (from an earlier run), if exactly one."""
    projects = {r[-1] for r in rows if r[-1]}
    return projects.pop() if len(projects) == 1 else None


def group_profile(  # noqa: PLR0913
    cur: psycopg.Cursor[Any],
    jid: int,
    adapter: str,
    group: str,
    rows: list[Any],
    *,
    store: TextStore,
    extractor: Any,
    streets: StreetIndex,
    budget: Budget,
    counts: Counter[str],
    log: Callable[[str], None],
) -> Profile | None:
    docs, seen_docs, documents = [], set(), []
    kind, first_seen = rows[0][0], rows[0][-2]
    for _kind, doc_id, doc_type, key, url, size, _seen, _project in rows:
        documents.append((doc_id, doc_type, url, size))
        if doc_id in seen_docs:
            continue
        seen_docs.add(doc_id)
        pages = json.loads(store.get(key)).get("pages") or []
        docs.append(fields.SourceDocument(doc_id, doc_type, [p["text"] for p in pages]))
    identifiers = frozenset((f.scheme, f.value) for d in docs for f in find_identifiers(d.pages))
    selection = fields.select_pages(
        docs, read_order=fields.GROUP_READ_ORDER, first_page_of=fields.GROUP_FIRST_PAGE
    )
    if not selection.pages or extractor is None:
        counts["groups: nothing to read" if extractor else "groups: LLM off"] += 1
        return None
    answer = fields_answer(
        cur, jid, extractor=extractor, selection=selection, budget=budget, counts=counts, log=log
    )
    if answer is None:
        return None
    kept = {v.field: v.value for v in fields.check(answer, selection).kept}
    raw_title = str((answer.get("title") or {}).get("value") or "")
    title = str(kept.get("title") or "")
    address = str(kept.get("address") or "") or None
    street = streets.match(f"{address or ''} {title}") if streets else None
    number = house_number(address or title, street.name) if street else None
    shown_address = (
        (f"{street.name} nr. {number}" if number else street.name) if street else address
    )
    return Profile(
        subject=f"group:{adapter}:{group}",
        source=adapter,
        kind=kind,
        title=title,
        street=normalize(street.name) if street else None,
        number=number,
        initiator=str(kept["initiator"]) if "initiator" in kept else None,
        identifiers=identifiers,
        point=(street.lon, street.lat) if street else None,
        first_seen=first_seen,
        documents=documents,
        address=shown_address,
        title_ok=bool(title) and not (looks_personal(raw_title) or looks_private_home(raw_title)),
    )


def _candidate(cur: psycopg.Cursor[Any], jid: int, d: Decision, state: str) -> None:
    assert d.target is not None
    assert d.target.project_id is not None
    cur.execute(
        """insert into link_candidate (jurisdiction_id, subject, subject_project_id,
               candidate_project_id, score, signals, state, decided_at)
           values (%s, %s, %s, %s, %s, %s, %s, case when %s = 'auto_published' then now() end)
           on conflict (jurisdiction_id, subject, candidate_project_id) do update
             set score = excluded.score, signals = excluded.signals
           returning state""",
        (jid, d.subject.subject, d.subject.project_id, d.target.project_id, d.score,
         json.dumps(d.signals, ensure_ascii=False), state, state),
    )  # fmt: skip


def _attach(
    cur: psycopg.Cursor[Any],
    jid: int,
    project_id: str,
    docs: Iterable[tuple[str, str, str, int | None]],
) -> int:
    n = 0
    for doc_id, doc_type, _url, _size in docs:
        cur.execute(
            """insert into project_document (jurisdiction_id, project_id, raw_document_id, role)
               values (%s, %s, %s, %s) on conflict do nothing""",
            (jid, project_id, doc_id, doc_type),
        )
        n += cur.rowcount
    return n


def _new_project(cur: psycopg.Cursor[Any], jid: int, g: Profile) -> str:
    slug = slug_for(g.title, g.subject)
    geom = "ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)" if g.point else "NULL"
    cur.execute(
        f"""insert into project (jurisdiction_id, slug, kind, status, title, address_text, geom,
                geom_precision, legal_regime, review_state)
            values (%(jid)s, %(slug)s, %(kind)s, 'in_preparation', %(title)s, %(address)s, {geom},
                %(precision)s, 'pre_catuc', 'auto_published')
            on conflict (jurisdiction_id, slug) do update set title = excluded.title
            returning id::text""",
        {"jid": jid, "slug": slug, "kind": g.kind, "title": g.title, "address": g.address,
         "lon": g.point[0] if g.point else None, "lat": g.point[1] if g.point else None,
         "precision": "street" if g.point else None},
    )  # fmt: skip
    row = cur.fetchone()
    assert row
    pid = str(row[0])
    documents = [
        {"label": None, "url": url, "size_bytes": size, "role": t}
        for _, t, url, size in g.documents
    ]
    cur.execute(
        "delete from project_event where project_id = %s and details->>'source' = %s",
        (pid, g.source),
    )
    cur.execute(
        """insert into project_event (jurisdiction_id, project_id, event_date, event_type, title,
               details, confidence, review_state)
           values (%s, %s, %s, 'document_added', 'Documentație publicată pe pagina de urbanism',
               %s, 'medium', 'auto_published')""",
        (jid, pid, (g.first_seen or datetime.now(UTC)).date(),
         json.dumps({"source": g.source, "kind": "listing", "official_title": g.title,
                     "documents": documents}, ensure_ascii=False)),
    )  # fmt: skip
    return pid


def run(  # noqa: PLR0913
    conn: psycopg.Connection[Any],
    store: TextStore,
    *,
    city: str,
    streets: StreetIndex,
    extractor: Any = None,
    monthly_usd: float = 2.0,
    log: Callable[[str], None] = lambda _: None,
) -> StageResult:
    result = StageResult()
    row = conn.execute("select id from jurisdiction where slug = %s", (city,)).fetchone()
    if not row:
        raise RuntimeError(f"jurisdiction {city} missing")
    jid = int(row[0])
    budget = Budget(monthly_usd)
    profiles = project_profiles(conn, jid, streets)
    with conn.transaction(), conn.cursor() as cur:
        for (adapter, group), rows in unlinked_groups(conn, jid).items():
            known = _known_project(rows)
            if known:  # linked before: new files in the folder join the same project
                docs = [(r[1], r[2], r[4], r[5]) for r in rows if not r[-1]]
                result.counts["documents attached"] += _attach(cur, jid, known, docs)
                result.counts["groups already linked"] += 1
                continue
            profile = group_profile(
                cur, jid, adapter, group, rows, store=store, extractor=extractor,
                streets=streets, budget=budget, counts=result.counts, log=log,
            )  # fmt: skip
            if profile:
                profiles.append(profile)
    rejected = frozenset(
        (subject, f"project:{candidate}")
        for subject, candidate in conn.execute(
            """select subject, candidate_project_id::text from link_candidate
               where jurisdiction_id = %s and state = 'rejected'""",
            (jid,),
        ).fetchall()
    )
    merged: dict[str, str] = {}
    for decision in decide(profiles, rejected):
        with conn.transaction(), conn.cursor() as cur:
            d = decision
            subject, target = d.subject, d.target
            if target and target.project_id in merged:  # follow earlier merges in this run
                target = next(p for p in profiles if p.project_id == merged[target.project_id])
                d = Decision(subject, target, d.score, d.signals, d.action)
            if subject.project_id and subject.project_id in merged:
                continue
            if d.action == "attach" and target:
                _candidate(cur, jid, d, "auto_published")
                result.counts["documents attached"] += _attach(
                    cur, jid, str(target.project_id), subject.documents
                )
                result.counts["groups attached"] += 1
            elif d.action == "merge" and target and subject.project_id:
                _candidate(cur, jid, d, "auto_published")
                cur.execute(
                    """update project set merged_into_id = %s
                       where id = %s and merged_into_id is null""",
                    (target.project_id, subject.project_id),
                )
                result.counts["projects merged"] += cur.rowcount
                merged[subject.project_id] = str(target.project_id)
            elif d.action == "review" and target:
                _candidate(cur, jid, d, "pending_review")
                result.counts["for review"] += 1
            elif d.action == "new":
                if not subject.title_ok:
                    result.counts["groups skipped: private or untitled"] += 1
                    continue
                pid = _new_project(cur, jid, subject)
                result.counts["documents attached"] += _attach(cur, jid, pid, subject.documents)
                result.counts["groups as projects"] += 1
    with conn.transaction(), conn.cursor() as cur:
        _log_run(cur, jid, None, "link", result)
    return result
