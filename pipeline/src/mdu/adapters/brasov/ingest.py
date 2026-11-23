"""Brașov listing ingestion: public debates and urbanism notices -> ProjectRecords."""

import re
from typing import Any

from mdu.adapters.brasov import council_debates, notices
from mdu.core.enums import ProjectKind, ProjectStatus
from mdu.core.http import HttpError, PoliteClient
from mdu.core.streets import StreetIndex, StreetPoint, house_number
from mdu.ingest import (
    DocumentLink,
    IngestStats,
    ProjectRecord,
    SourceDoc,
    looks_personal,
    looks_private_home,
)

_KIND = re.compile(r"\bP\.?\s?U\.?\s?([ZD])\b\.?")
# A house number directly after the street name ("str. Lungă nr. 5", "Calea X, nr. 35A"); other
# numbers in a title ("CU nr 2456/2022", "HCL nr. 198") are not addresses.

DEBATE_STATUS: dict[str, ProjectStatus] = {
    "Aprobat prin HCL": "approved",
    "În dezbatere publică": "in_public_consultation",
    "Retras de pe ordinea de zi": "withdrawn",
    "Respins": "rejected",
    # The public-debate period has ended; the draft goes on to the council (it appears on later
    # agendas, e.g. session 470), so this isn't a lapsed draft.
    "Termen expirat conform legii": "expired",
}
_DEBATE_PREFIX = re.compile(
    r"^Proiect(?:ul)?\s+(?:de\s+hot[ăa]r[âa]re\s+)?"
    r"(?:al?\s+Consiliului\s+Local(?:\s+al\s+Municipiului\s+Brașov)?\s+)?(?:pentru|privind)\s*:?\s+"
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
    number = house_number(title, street.name)
    return (f"{street.name} nr. {number}" if number else street.name), street


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


# A notice about a plan in another town ("intravilan municipiul Săcele", "comuna Hărman"): the city
# sometimes publishes those too. Brașov itself is allowed.
_ELSEWHERE = re.compile(
    r"\b(?:municipiul|ora[șşs]ul|comuna|satul)\s+(?!Bra[șşs]ov\b)[A-ZĂÂÎȘŞȚŢ][\w-]+", re.I
)
# Older notices are worded variously ("ANUNŢ – INFORMARE ŞI CONSULTARE …", "Anunț informare și …").
_NOTICE_WORDS = re.compile(r"\banun[țţt]\w*\b.{0,40}\binformare\b", re.I)


def elsewhere(title: str) -> bool:
    """Whether a title places the plan in a town other than Brașov."""
    m = _ELSEWHERE.search(title)
    return m is not None and m.group(0).split()[-1][:1].isupper()


def is_planning_notice(title: str) -> bool:
    """A public-information notice about a PUZ/PUD (articles walked by id carry no category)."""
    return bool(_NOTICE_WORDS.search(title)) and kind_of(title) is not None


def notice_record(
    article_id: int,
    page: Any,  # mdu.core.http.Response
    article: notices.Article,
    streets: StreetIndex,
    stats: IngestStats,
) -> ProjectRecord | None:
    """The project a PUZ/PUD notice announces, or None (counted in `stats`)."""
    kind = kind_of(article.title)
    if article.published is None:
        stats.skip("article without a publication date")
        return None
    if kind is None:
        stats.skip("not an urbanism PUZ/PUD notice")
        return None
    if elsewhere(article.title):
        stats.skip("a plan in another town")
        return None
    if looks_personal(article.title) or looks_private_home(article.title):
        stats.skipped_personal += 1
        return None
    address, street = _address(streets, article.title)
    return ProjectRecord(
        private_key=f"notice:{article_id}",
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


def urbanism_notices(
    client: PoliteClient, streets: StreetIndex, stats: IngestStats
) -> list[ProjectRecord]:
    resp = client.get(notices.LISTING_URL)
    if resp.status != 200:  # noqa: PLR2004
        raise HttpError(f"notices listing returned HTTP {resp.status}")
    out = []
    for item in notices.parse_listing(resp.content):
        if item.category != "urbanism" or kind_of(item.title) is None:
            stats.skip("not an urbanism PUZ/PUD notice")
            continue
        if looks_personal(item.title):
            stats.skipped_personal += 1
            continue
        page = client.get(item.url)  # served with HTTP 404 but contains the article
        article = notices.parse_article(page.content, page.url)
        if article is None:
            stats.skip("article without a publication date")
            continue
        record = notice_record(item.article_id, page, article, streets, stats)
        if record is not None:
            out.append(record)
    return out
