"""Pipeline stages 1–3: discover, fetch and extract (PLAN §7, M2.2–M2.3).

Every stage reads and writes database state, so a crashed run resumes where it stopped and
re-running a stage with nothing new to do changes nothing:

- `discover` queues URLs as `pending` rows in `fetch`. A URL that is already pending, or was
  fetched before, isn't queued again (the partial unique index `fetch_pending_url_uq` backs
  this up). Failed URLs are queued again, so the next run retries them.
- `fetch` works through pending rows one at a time, each in its own transaction. It sends the
  previous ETag / Last-Modified, records 304s as `unchanged`, stores new bytes once per SHA-256
  (`mdu.core.documents`), and skips files over `max_bytes` (PLAN §5).
- `extract` reads stored PDFs from R2 (no requests to the source sites), writes their text page by
  page to R2 under a key that names the extractor version, and fills `raw_document.text_r2_key`,
  `text_head`, `page_count` and `ocr_used`. Documents already extracted by the current version are
  skipped; a new version processes everything again. Unreadable PDFs get a text file holding the
  error, so they aren't retried until the version changes.
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol
from zoneinfo import ZoneInfo

import psycopg

from mdu.core import extract as extractor
from mdu.core.documents import Upload, store_raw_document
from mdu.core.http import HttpError, PoliteClient, TooLarge

DEFAULT_MAX_BYTES = 30 * 1024 * 1024
NIGHT_START, NIGHT_END = 22, 6  # PLAN §7: big back-fills only at night, Bucharest time


@dataclass(frozen=True)
class DiscoveredItem:
    url: str
    hints: dict[str, Any] = field(default_factory=dict)


@dataclass
class StageResult:
    counts: Counter[str] = field(default_factory=Counter)
    requests: int = 0

    def as_json(self) -> str:
        return json.dumps({**self.counts, "requests": self.requests})


def is_night(now: datetime | None = None, tz: str = "Europe/Bucharest") -> bool:
    hour = (now or datetime.now(UTC)).astimezone(ZoneInfo(tz)).hour
    return hour >= NIGHT_START or hour < NIGHT_END


def _ids(cur: psycopg.Cursor[Any], city: str, adapter: str, base_url: str) -> tuple[int, str]:
    cur.execute("select id from jurisdiction where slug = %s", (city,))
    j = cur.fetchone()
    if not j:
        raise RuntimeError(f"jurisdiction {city} missing; the deploy step creates it")
    cur.execute(
        """insert into source (jurisdiction_id, adapter, base_url) values (%s, %s, %s)
           on conflict (jurisdiction_id, adapter) do update set base_url = excluded.base_url
           returning id""",
        (j[0], adapter, base_url),
    )
    s = cur.fetchone()
    assert s
    return int(j[0]), str(s[0])


def _log_run(
    cur: psycopg.Cursor[Any], jid: int, adapter: str | None, stage: str, result: StageResult
) -> None:
    cur.execute(
        """insert into pipeline_run (jurisdiction_id, adapter, stage, status, finished_at, stats)
           values (%s, %s, %s, 'succeeded', now(), %s)""",
        (jid, adapter, stage, result.as_json()),
    )


def discover(
    conn: psycopg.Connection[Any],
    *,
    city: str,
    adapter: str,
    base_url: str,
    items: list[DiscoveredItem],
) -> StageResult:
    result = StageResult()
    with conn.transaction(), conn.cursor() as cur:
        jid, source_id = _ids(cur, city, adapter, base_url)
        for item in items:
            cur.execute(
                """insert into "fetch" (jurisdiction_id, source_id, url, status, hints)
                   select %(jid)s, %(source)s, %(url)s, 'pending', %(hints)s
                   where not exists (
                       select 1 from "fetch"
                       where source_id = %(source)s and url = %(url)s
                         and status in ('pending', 'fetched', 'unchanged', 'skipped'))
                   on conflict (source_id, url) where status = 'pending' do nothing""",
                {"jid": jid, "source": source_id, "url": item.url, "hints": json.dumps(item.hints)},
            )
            result.counts["queued" if cur.rowcount else "already_known"] += 1
        _log_run(cur, jid, adapter, "discover", result)
    return result


def _previous(cur: psycopg.Cursor[Any], source_id: str, url: str) -> tuple[Any, ...] | None:
    """Validators and document of the last successful fetch of this URL."""
    cur.execute(
        """select etag, last_modified, raw_document_id from "fetch"
           where source_id = %s and url = %s and status in ('fetched', 'unchanged')
             and raw_document_id is not null
           order by fetched_at desc limit 1""",
        (source_id, url),
    )
    return cur.fetchone()


def fetch(  # noqa: PLR0913
    conn: psycopg.Connection[Any],
    client: PoliteClient,
    *,
    city: str,
    adapter: str | None = None,
    limit: int = 100,
    upload: Upload | None,
    max_bytes: int = DEFAULT_MAX_BYTES,
    log: Callable[[str], None] = lambda _: None,
) -> StageResult:
    result = StageResult()
    start_requests = client.requests_sent
    with conn.cursor() as cur:
        cur.execute("select id from jurisdiction where slug = %s", (city,))
        j = cur.fetchone()
        if not j:
            raise RuntimeError(f"jurisdiction {city} missing")
        jid = int(j[0])
    for n in range(limit):
        with conn.transaction(), conn.cursor() as cur:
            cur.execute(
                """select f.id, f.source_id, f.url, f.hints
                   from "fetch" f join source s on s.id = f.source_id
                   where f.jurisdiction_id = %s and f.status = 'pending'
                     and (%s::text is null or s.adapter = %s)
                   order by f.discovered_at, f.id
                   limit 1 for update of f skip locked""",
                (jid, adapter, adapter),
            )
            row = cur.fetchone()
            if row is None:
                break
            fetch_id, source_id, url, hints = row
            outcome = _fetch_one(
                cur,
                client,
                jid=jid,
                city=city,
                fetch_id=fetch_id,
                source_id=source_id,
                url=url,
                listed_size=(hints or {}).get("size_bytes"),
                upload=upload,
                max_bytes=max_bytes,
            )
            result.counts[outcome] += 1
        if (n + 1) % 10 == 0:
            log(f"fetch: {n + 1} done ({dict(result.counts)})")
    result.requests = client.requests_sent - start_requests
    with conn.transaction(), conn.cursor() as cur:
        _log_run(cur, jid, adapter, "fetch", result)
    return result


def _fetch_one(  # noqa: PLR0913
    cur: psycopg.Cursor[Any],
    client: PoliteClient,
    *,
    jid: int,
    city: str,
    fetch_id: str,
    source_id: str,
    url: str,
    listed_size: int | None,
    upload: Upload | None,
    max_bytes: int,
) -> str:
    previous = _previous(cur, source_id, url)
    etag, last_modified, prev_doc = previous if previous else (None, None, None)
    now = datetime.now(UTC)

    def finish(status: str, **cols: Any) -> str:
        cols = {"status": status, "fetched_at": now, **cols}
        sets = ", ".join(f"{k} = %({k})s" for k in cols)
        cur.execute(f'update "fetch" set {sets} where id = %(id)s', {**cols, "id": fetch_id})
        return status

    if listed_size and listed_size > max_bytes:  # known from the listing: no request needed
        return finish("skipped", error=f"listed size {listed_size} > {max_bytes} bytes")
    client.max_bytes = max_bytes
    try:
        resp = client.get(url, etag=etag, last_modified=last_modified)
    except TooLarge as exc:
        return finish("skipped", error=f"too large: {exc}")
    except HttpError as exc:
        return finish("failed", error=f"{type(exc).__name__}: {exc}"[:500])

    meta = {"http_status": resp.status, "etag": resp.etag, "last_modified": resp.last_modified}
    if resp.not_modified and prev_doc:
        return finish("unchanged", raw_document_id=prev_doc, **meta)
    if resp.status != 200:  # noqa: PLR2004
        return finish("failed", error=f"HTTP {resp.status}", **meta)
    doc_id, created = store_raw_document(
        cur,
        jurisdiction_id=jid,
        city=city,
        url=resp.url,
        content=resp.content,
        content_type=resp.content_type,
        fetched_at=now,
        upload=upload,
    )
    status = "fetched" if created or str(doc_id) != str(prev_doc) else "unchanged"
    return finish(status, raw_document_id=doc_id, **meta)


class TextStore(Protocol):
    def get(self, key: str) -> bytes: ...
    def put(self, key: str, data: bytes, content_type: str | None = None) -> None: ...


def extract(  # noqa: PLR0913
    conn: psycopg.Connection[Any],
    store: TextStore,
    *,
    city: str,
    limit: int = 100,
    ocr: bool = True,
    log: Callable[[str], None] = lambda _: None,
) -> StageResult:
    result = StageResult()
    version = extractor.EXTRACTOR_VERSION
    current = f"%.v{version}.json"
    with conn.cursor() as cur:
        cur.execute("select id from jurisdiction where slug = %s", (city,))
        j = cur.fetchone()
        if not j:
            raise RuntimeError(f"jurisdiction {city} missing")
        jid = int(j[0])
    for n in range(limit):
        with conn.transaction(), conn.cursor() as cur:
            cur.execute(
                """select id, sha256, r2_key from raw_document
                   where jurisdiction_id = %s and mime like 'application/pdf%%'
                     and r2_key is not null
                     and (text_r2_key is null or text_r2_key not like %s)
                   order by created_at, id
                   limit 1 for update skip locked""",
                (jid, current),
            )
            row = cur.fetchone()
            if row is None:
                break
            doc_id, sha, key = row
            text_key = extractor.text_r2_key(city, sha, version)
            try:
                text = extractor.extract_pdf(store.get(key), ocr=ocr)
            except extractor.ExtractionError as exc:
                error = {"version": version, "error": str(exc), "pages": []}
                store.put(text_key, json.dumps(error).encode(), "application/json")
                cur.execute(
                    """update raw_document set text_r2_key = %s, text_head = null,
                       ocr_used = false where id = %s""",
                    (text_key, doc_id),
                )
                result.counts["unreadable"] += 1
                log(f"extract: {sha[:12]} unreadable ({exc})")
                continue
            store.put(text_key, text.to_json(), "application/json")
            cur.execute(
                """update raw_document set text_r2_key = %s, text_head = %s, page_count = %s,
                   ocr_used = %s where id = %s""",
                (text_key, text.head(), len(text.pages), text.ocr_used, doc_id),
            )
            result.counts["extracted"] += 1
            result.counts["pages"] += len(text.pages)
            result.counts["ocr_pages"] += text.ocr_pages
            for note, count in text.skipped_pages.items():
                result.counts[f"pages skipped: {note}"] += count
        if (n + 1) % 10 == 0:
            log(f"extract: {n + 1} done ({dict(result.counts)})")
    with conn.transaction(), conn.cursor() as cur:
        _log_run(cur, jid, None, "extract", result)
    return result
