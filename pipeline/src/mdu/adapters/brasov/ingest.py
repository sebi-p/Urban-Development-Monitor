"""Brașov listing ingestion: public debates and urbanism notices -> ProjectRecords."""

import re
from collections.abc import Callable

from mdu.adapters.brasov import council_debates, notices
from mdu.core.enums import ProjectKind, ProjectStatus
from mdu.core.http import HttpError, PoliteClient
from mdu.core.streets import StreetIndex, StreetPoint, fold
from mdu.ingest import (
    DocumentLink,
    IngestStats,
    ProjectRecord,
    SourceDoc,
    looks_personal,
    looks_private_home,
)

_KIND = re.compile(r"\bP\.?\s?U\.?\s?([ZD])\b\.?")
_NUMBER = re.compile(r"\bnr\.?\s*(\d+[a-z]?)\b")

DEBATE_STATUS: dict[str, ProjectStatus] = {
    "Aprobat prin HCL": "approved",
    "În dezbatere publică": "in_public_consultation",
    "Retras de pe ordinea de zi": "withdrawn",
    "Respins": "rejected",
    # "Termen expirat conform legii" has no matching status yet; those debates are skipped.
}
_DEBATE_PREFIX = re.compile(
    r"^Proiect(?:ul)?\s+(?:de\s+hot[ăa]r[âa]re\s+)?"
    r"(?:a\s+Consiliului\s+Local(?:\s+al\s+Municipiului\s+Brașov)?\s+)?(?:pentru|privind)\s*:?\s+"
    r"(?:aprobarea\s+documenta[țţt]iei\s+de\s+urbanism\s+)?",
    re.I,
)
_NOTICE_PREFIX = re.compile(
    r"^ANUN[ȚŢT]\s+(?:DE\s+)?INFORMARE\s+[ȘŞS]I\s+CONSULTARE\s+(?:A\s+)?PUBLIC(?:ULUI)?\s+INTERESAT\s*[–-]\s*",
    re.I,
)


def kind_of(title: str) -> ProjectKind | None:
    """'puz' or 'pud' from a title mentioning P.U.Z. / PUD, else None."""
    m = _KIND.search(title)
    if not m:
        return None
    return "puz" if m.group(1).upper() == "Z" else "pud"


def _tidy(title: str, prefix: re.Pattern[str]) -> str:
    t = prefix.sub("", title).strip()
    return t[:1].upper() + t[1:]


def _address(streets: StreetIndex, title: str) -> tuple[str | None, StreetPoint | None]:
    street = streets.match(title)
    if street is None:
        return None, None
    m = _NUMBER.search(fold(title))
    return (f"{street.name} nr. {m.group(1)}" if m else street.name), street


def debates(client: PoliteClient, streets: StreetIndex, stats: IngestStats) -> list[ProjectRecord]:
    resp = client.get(council_debates.LISTING_URL)
    if resp.status != 200:  # noqa: PLR2004
        raise HttpError(f"debate listing returned HTTP {resp.status}")
    source = SourceDoc(resp.url, resp.status, resp.content, resp.content_type)
    return debate_records(source, streets, stats)


def debate_records(
    source: SourceDoc, streets: StreetIndex, stats: IngestStats
) -> list[ProjectRecord]:
    """Pure: one fetched debate listing -> project records (tested on the fixture)."""
    out = []
    for d in council_debates.parse_listing(source.content):
        kind = kind_of(d.title)
        if kind is None:
            stats.skip("not an urban plan (PUZ/PUD)")
            continue
        if looks_personal(d.title) or looks_private_home(d.title):
            stats.skipped_personal += 1
            continue
        status = DEBATE_STATUS.get(d.status)
        if status is None or d.published is None:
            stats.skip(f"status without a mapping: {d.status}")
            continue
        address, street = _address(streets, d.title)
        out.append(
            ProjectRecord(
                private_key=f"debate:{d.folder}",
                title=_tidy(d.title, _DEBATE_PREFIX),
                official_title=d.title,
                kind=kind,
                status=status,
                event_type="consultation_opened",
                event_date=d.published,
                event_title="Publicat în dezbatere publică",
                source=source,
                address_text=address,
                street=street,
                documents=[DocumentLink(f.label, f.url, f.size_bytes) for f in d.files],
                status_text=d.status,
                consultation=d.period,
            )
        )
    return out


def urbanism_notices(
    client: PoliteClient, streets: StreetIndex, stats: IngestStats
) -> list[ProjectRecord]:
    resp = client.get(notices.LISTING_URL)
    if resp.status != 200:  # noqa: PLR2004
        raise HttpError(f"notices listing returned HTTP {resp.status}")
    out = []
    for item in notices.parse_listing(resp.content):
        kind = kind_of(item.title)
        if item.category != "urbanism" or kind is None:
            stats.skip("not an urbanism PUZ/PUD notice")
            continue
        if looks_personal(item.title):
            stats.skipped_personal += 1
            continue
        page = client.get(item.url)  # served with HTTP 404 but contains the article
        article = notices.parse_article(page.content, page.url)
        if article is None or article.published is None:
            stats.skip("article without a publication date")
            continue
        if looks_personal(article.title) or looks_private_home(article.title):
            stats.skipped_personal += 1
            continue
        address, street = _address(streets, article.title)
        out.append(
            ProjectRecord(
                private_key=f"notice:{item.article_id}",
                title=_tidy(article.title, _NOTICE_PREFIX),
                official_title=article.title,
                kind=kind,
                status="in_preparation",
                event_type="notice_published",
                event_date=article.published,
                event_title="Anunț de informare și consultare a publicului",
                source=SourceDoc(page.url, page.status, page.content, page.content_type),
                address_text=address,
                street=street,
                documents=[DocumentLink(a.label or "Document", a.url) for a in article.attachments],
            )
        )
    return out


ADAPTERS: dict[
    str, tuple[str, Callable[[PoliteClient, StreetIndex, IngestStats], list[ProjectRecord]]]
] = {
    "brasov.council_debates": (council_debates.LISTING_URL, debates),
    "brasov.notices": (notices.LISTING_URL, urbanism_notices),
}
