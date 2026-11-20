"""Announcements (P0). See docs/sources/brasov.md#notices."""

import base64
import binascii
import re
from dataclasses import dataclass
from datetime import date

from mdu.adapters.brasov.common import (
    BASE_URL,
    absolute,
    clean,
    main_content,
    parse,
    parse_ro_date,
)

LISTING_URL = f"{BASE_URL}/anunturi"
_ARTICLE = re.compile(r"/detalii-articol/([^/]+)/[^/]+/([A-Za-z0-9+/=_-]+)/?$")


def decode_article_id(token: str) -> int | None:
    """Article ids are base64-encoded sequential numbers: 'Mzc4Mjc' -> 37827."""
    try:
        raw = base64.b64decode(token + "=" * (-len(token) % 4), validate=False).decode()
    except (binascii.Error, UnicodeDecodeError):
        return None
    return int(raw) if raw.isdigit() else None


@dataclass(frozen=True)
class NoticeLink:
    article_id: int
    category: str
    url: str
    title: str


def parse_listing(html: bytes | str) -> list[NoticeLink]:
    out: dict[int, NoticeLink] = {}
    for a in main_content(parse(html)).css("a[href*='/detalii-articol/']"):
        url = absolute(a.attributes.get("href") or "")
        m = _ARTICLE.search(url)
        if not m:
            continue
        article_id = decode_article_id(m.group(2))
        title = clean(a)
        if article_id is not None and (
            article_id not in out or len(title) > len(out[article_id].title)
        ):
            out[article_id] = NoticeLink(article_id, m.group(1), url, title)
    return sorted(out.values(), key=lambda n: -n.article_id)


@dataclass(frozen=True)
class Attachment:
    url: str
    label: str


@dataclass(frozen=True)
class Article:
    title: str
    published: date | None
    attachments: list[Attachment]


_PUBLISHED = re.compile(r"Data publicării:?\s*(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})")
_DOCUMENT = re.compile(r"\.(pdf|docx?|zip|jpe?g|png)(\?|$)", re.I)


def parse_article(html: bytes | str, url: str) -> Article | None:
    """Article pages are served with HTTP 404 but still contain the article (docs/sources)."""
    main = main_content(parse(html))
    heading = main.css_first("h1, h2, h3")
    published = _PUBLISHED.search(clean(main))
    if heading is None or published is None:
        return None
    attachments = []
    seen = set()
    for a in main.css("a[href]"):
        href = absolute(a.attributes.get("href") or "", url)
        if _DOCUMENT.search(href) and href not in seen and "/file-zone/regulamente/" not in href:
            seen.add(href)
            attachments.append(Attachment(href, clean(a)))
    return Article(clean(heading), parse_ro_date(published.group(1)), attachments)
