"""Brașov discover (PLAN §7 stage 1): which document URLs to fetch, with listing hints."""

from collections.abc import Callable

from mdu.adapters.brasov import council_debates, notices
from mdu.adapters.brasov.ingest import kind_of
from mdu.core.http import HttpError, PoliteClient
from mdu.stages import DiscoveredItem


def debate_documents(client: PoliteClient, *, include_all: bool = False) -> list[DiscoveredItem]:
    """Files of the public debates. Urban plans (PUZ/PUD) only, unless include_all (back-fill)."""
    resp = client.get(council_debates.LISTING_URL)
    if resp.status != 200:  # noqa: PLR2004
        raise HttpError(f"debate listing returned HTTP {resp.status}")
    items = []
    for d in council_debates.parse_listing(resp.content):
        if not include_all and kind_of(d.title) is None:
            continue
        for f in d.files:
            items.append(
                DiscoveredItem(
                    f.url,
                    {
                        "label": f.label,
                        "size_bytes": f.size_bytes,
                        "listing_title": d.title,
                        "published": d.published.isoformat() if d.published else None,
                        "listing_status": d.status,
                    },
                )
            )
    return items


def notice_attachments(client: PoliteClient, *, include_all: bool = False) -> list[DiscoveredItem]:
    """Attachments of urbanism PUZ/PUD notices (all urbanism notices if include_all)."""
    resp = client.get(notices.LISTING_URL)
    if resp.status != 200:  # noqa: PLR2004
        raise HttpError(f"notices listing returned HTTP {resp.status}")
    items = []
    for n in notices.parse_listing(resp.content):
        if n.category != "urbanism" or (not include_all and kind_of(n.title) is None):
            continue
        page = client.get(n.url)  # served with HTTP 404 but contains the article
        article = notices.parse_article(page.content, page.url)
        if article is None:
            continue
        for a in article.attachments:
            items.append(
                DiscoveredItem(
                    a.url,
                    {
                        "label": a.label,
                        "article_id": n.article_id,
                        "listing_title": article.title,
                        "published": article.published.isoformat() if article.published else None,
                    },
                )
            )
    return items


DISCOVER: dict[str, tuple[str, Callable[..., list[DiscoveredItem]]]] = {
    "brasov.council_debates": (council_debates.LISTING_URL, debate_documents),
    "brasov.notices": (notices.LISTING_URL, notice_attachments),
}
