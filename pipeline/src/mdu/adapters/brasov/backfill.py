"""Notices back-fill (M5.1, ADR 0018): the listing shows about 90 days and its date filter is
behind a Cloudflare Turnstile check, so older notices are read by article number, which is
sequential across the whole site (about 10% of numbers are articles; numbers near 3,000 are from
late 2019). A PUZ/PUD public-information notice becomes a project, like on the listing, and its
attachments are queued."""

from __future__ import annotations

from mdu.adapters.brasov import notices
from mdu.adapters.brasov.discover import attachment_items
from mdu.adapters.brasov.ingest import is_planning_notice, notice_record
from mdu.core.adapter import Walked
from mdu.core.http import HttpError, PoliteClient
from mdu.core.streets import StreetIndex
from mdu.ingest import IngestStats


def newest_article(client: PoliteClient) -> int:
    """The highest article number on the listing."""
    resp = client.get(notices.LISTING_URL)
    if resp.status != 200:  # noqa: PLR2004
        raise HttpError(f"notices listing returned HTTP {resp.status}")
    found = notices.parse_listing(resp.content)
    if not found:
        raise HttpError("notices listing has no articles")
    return max(n.article_id for n in found)


def read_article(
    client: PoliteClient, streets: StreetIndex, stats: IngestStats, article_id: int
) -> Walked:
    page = client.get(notices.article_url(article_id))  # articles are served with HTTP 404
    article = notices.parse_article(page.content, page.url)
    if article is None:
        return Walked(found=False)
    if not is_planning_notice(article.title):
        stats.skip("not a PUZ/PUD notice")
        return Walked(found=True, published=article.published)
    record = notice_record(article_id, page, article, streets, stats)
    if record is None:
        return Walked(found=True, published=article.published)
    return Walked(
        found=True,
        published=article.published,
        record=record,
        items=tuple(attachment_items(article_id, article)),
    )
