"""Announcements (P0). See docs/sources/brasov.md#notices."""

import base64
import binascii
import re
from dataclasses import dataclass

from mdu.adapters.brasov.common import BASE_URL, absolute, clean, main_content, parse

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
