"""Writes adapter output to Postgres: the first real ingestion slice (M2.4 for listings).

Adapters turn source pages into `ProjectRecord`s; `write_records` stores the source snapshot in
R2 (`raw/<city>/<yyyy>/<sha256>.<ext>`, private), records it as a `raw_document`, and upserts
projects, their timeline event (citing that snapshot) and any consultation window. Re-running
with the same input changes nothing but timestamps. Only the pipeline writes (ADR 0003).
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any

import psycopg

from mdu.core.documents import store_raw_document
from mdu.core.enums import EventType, ProjectKind, ProjectStatus
from mdu.core.streets import StreetPoint, fold

CATUC_FROM = date(2026, 8, 25)  # Law 169/2026 in force; earlier procedures stay pre-CATUC

# Wording that always suggests a private individual (PLAN §11). Matching items are skipped.
_PERSONAL = re.compile(
    r"\b(domnul|doamna|dl\.|dna\.|d-?l\.|d-?na\.|persoan[aă] fizic[aă]|p\.?f\.?a\.?|cnp)\b",
    re.I,
)
# Role words are fine only when an organisation follows (companies and public bodies).
_ROLE = re.compile(
    r"\b(?:initiator|beneficiar|solicitant|proprietar|petent)(?:i|ul|ii|a|ei)?\b\s*:?\s*([^,;]{0,80})",
    re.I,
)
_ORGANISATION = re.compile(
    r"\b(s\.?r\.?l|s\.?a|s\.?c|srl|sa|sc|fundatia|asociatia|municipiul|primaria|consiliul|"
    r"parohia|episcopia|mitropolia|universitatea|scoala|liceul|spitalul|regia|compania|"
    r"directia|institutul|ministerul|judetul|uat|societatea|cooperativa|clubul|federatia)\b",
    re.I,
)


def looks_personal(text: str) -> bool:
    """True when the text may name a private individual; such items are skipped, not published."""
    folded = fold(text)
    if _PERSONAL.search(folded):
        return True
    return any(not _ORGANISATION.search(m.group(1)) for m in _ROLE.finditer(folded))


# A single private house: street + number identify its owner even without a name (PLAN §11).
# Plural "locuințe" (collective housing, subdivisions) is fine.
_SINGLE_HOME = re.compile(
    r"\b(locuinta|casa)\b(?!\s+(colectiv|de\s+cultura|parohial))"
    r"|\blocuinta\s+(unifamiliala|individuala)\b",
    re.I,
)


def looks_private_home(text: str) -> bool:
    return bool(_SINGLE_HOME.search(fold(text)))


def slug_for(title: str, private_key: str) -> str:
    """Readable slug from the official title plus a short hash of a private, stable key (never the
    city's folder name, which can contain an applicant's name)."""
    words = re.sub(r"[^a-z0-9]+", "-", fold(title)).strip("-")
    words = "-".join(w for w in words.split("-") if w not in {"p", "u", "z", "d"})[:60].strip("-")
    digest = hashlib.sha1(private_key.encode(), usedforsecurity=False).hexdigest()[:6]
    return f"{words}-{digest}" if words else digest


@dataclass(frozen=True)
class SourceDoc:
    url: str
    status: int
    content: bytes
    content_type: str | None
    fetched_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.content).hexdigest()


@dataclass(frozen=True)
class DocumentLink:
    label: str
    url: str
    size_bytes: int | None = None


@dataclass
class ProjectRecord:
    private_key: str  # stable per source item; hashed into the slug, never stored in clear
    title: str
    official_title: str
    kind: ProjectKind
    status: ProjectStatus
    event_type: EventType
    event_date: date
    event_title: str
    source: SourceDoc
    address_text: str | None = None
    street: StreetPoint | None = None
    documents: list[DocumentLink] = field(default_factory=list)
    status_text: str | None = None
    consultation: tuple[date, date] | None = None

    @property
    def slug(self) -> str:
        return slug_for(self.title, self.private_key)


@dataclass
class IngestStats:
    projects: int = 0
    with_location: int = 0
    skipped_personal: int = 0
    skipped_other: dict[str, int] = field(default_factory=dict)

    def skip(self, reason: str) -> None:
        self.skipped_other[reason] = self.skipped_other.get(reason, 0) + 1


def write_records(  # noqa: PLR0913
    conn: psycopg.Connection[Any],
    *,
    city: str,
    adapter: str,
    base_url: str,
    records: list[ProjectRecord],
    upload: Callable[[str, bytes, str | None], None] | None,
    stats: IngestStats,
) -> None:
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("select id from jurisdiction where slug = %s", (city,))
        j = cur.fetchone()
        if not j:
            raise RuntimeError(f"jurisdiction {city} missing; deploy runs db:deploy to create it")
        jid = j[0]
        cur.execute(
            """insert into source (jurisdiction_id, adapter, base_url, last_success_at)
               values (%s, %s, %s, now())
               on conflict (jurisdiction_id, adapter)
               do update set last_success_at = now(), base_url = excluded.base_url
               returning id""",
            (jid, adapter, base_url),
        )
        source = cur.fetchone()
        assert source
        doc_ids: dict[str, str] = {}
        for rec in records:
            sha = rec.source.sha256
            if sha not in doc_ids:
                doc_ids[sha], _ = store_raw_document(
                    cur,
                    jurisdiction_id=jid,
                    city=city,
                    url=rec.source.url,
                    content=rec.source.content,
                    content_type=rec.source.content_type,
                    fetched_at=rec.source.fetched_at,
                    upload=upload,
                    doc_type="listing",
                )
                cur.execute(
                    """insert into "fetch" (jurisdiction_id, source_id, url, status, fetched_at,
                           http_status, raw_document_id)
                       values (%s, %s, %s, 'fetched', %s, %s, %s)""",
                    (jid, source[0], rec.source.url, rec.source.fetched_at, rec.source.status,
                     doc_ids[sha]),
                )  # fmt: skip
            _upsert_project(cur, jid, adapter, rec, doc_ids[sha])
            stats.projects += 1
            stats.with_location += rec.street is not None
        cur.execute(
            """insert into pipeline_run
                   (jurisdiction_id, adapter, stage, status, finished_at, stats)
               values (%s, %s, 'ingest', 'succeeded', now(), %s)""",
            (jid, adapter, json.dumps(stats.__dict__)),
        )


def _upsert_project(
    cur: psycopg.Cursor[Any], jid: int, adapter: str, rec: ProjectRecord, doc_id: str
) -> None:
    geom = "ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)" if rec.street is not None else "NULL"
    params: dict[str, object] = {
        "jid": jid,
        "slug": rec.slug,
        "kind": rec.kind,
        "status": rec.status,
        "title": rec.title,
        "address": rec.address_text,
        "precision": "street" if rec.street else None,
        "regime": "catuc" if rec.event_date >= CATUC_FROM else "pre_catuc",
        "lon": rec.street.lon if rec.street else None,
        "lat": rec.street.lat if rec.street else None,
    }
    cur.execute(
        f"""insert into project (jurisdiction_id, slug, kind, status, title, address_text, geom,
                geom_precision, legal_regime, review_state)
            values (%(jid)s, %(slug)s, %(kind)s, %(status)s, %(title)s, %(address)s, {geom},
                %(precision)s, %(regime)s, 'auto_published')
            on conflict (jurisdiction_id, slug) do update set
                kind = excluded.kind, status = excluded.status, title = excluded.title,
                address_text = excluded.address_text, geom = excluded.geom,
                geom_precision = excluded.geom_precision, legal_regime = excluded.legal_regime,
                updated_at = now()
            returning id""",
        params,
    )
    row = cur.fetchone()
    assert row
    pid = row[0]
    details = {
        "source": adapter,
        "source_url": rec.source.url,
        "official_title": rec.official_title,
        "status_text": rec.status_text,
        "documents": [d.__dict__ for d in rec.documents],
    }
    cur.execute(
        "delete from project_event where project_id = %s and details->>'source' = %s",
        (pid, adapter),
    )
    cur.execute(
        """insert into project_event (jurisdiction_id, project_id, event_date, event_type,
               raw_document_id, title, details, confidence, review_state)
           values (%s, %s, %s, %s, %s, %s, %s, 'high', 'auto_published')""",
        (jid, pid, rec.event_date, rec.event_type, doc_id, rec.event_title, json.dumps(details)),
    )
    # Each project is written by exactly one adapter so far (linking sources is M3.3).
    cur.execute("delete from consultation where project_id = %s", (pid,))
    if rec.consultation:
        cur.execute(
            """insert into consultation (jurisdiction_id, project_id, opens_on, closes_on,
                   submit_instructions, raw_document_id)
               values (%s, %s, %s, %s, %s, %s)""",
            (jid, pid, rec.consultation[0], rec.consultation[1],
             "Conform anunțului de dezbatere publică (vezi documentele).", doc_id),
        )  # fmt: skip
