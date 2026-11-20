"""Immutable document snapshots: bytes in private R2, one `raw_document` row per SHA-256."""

from __future__ import annotations

import hashlib
from collections.abc import Callable
from datetime import datetime
from typing import Any

import psycopg

Upload = Callable[[str, bytes, str | None], None]


def extension_for(content_type: str | None, url: str) -> str:
    from mdu.fixtures import extension_for as ext  # noqa: PLC0415

    return ext(content_type, url)


def r2_key(city: str, fetched_at: datetime, sha256: str, content_type: str | None, url: str) -> str:
    return f"raw/{city}/{fetched_at:%Y}/{sha256}.{extension_for(content_type, url)}"


def store_raw_document(  # noqa: PLR0913
    cur: psycopg.Cursor[Any],
    *,
    jurisdiction_id: int,
    city: str,
    url: str,
    content: bytes,
    content_type: str | None,
    fetched_at: datetime,
    upload: Upload | None,
    doc_type: str | None = None,
) -> tuple[str, bool]:
    """Returns (raw_document id, created). Identical bytes within a jurisdiction are stored once:
    a second URL with the same content links to the existing row (PLAN §7 stage 2)."""
    sha = hashlib.sha256(content).hexdigest()
    cur.execute(
        "select id from raw_document where jurisdiction_id = %s and sha256 = %s",
        (jurisdiction_id, sha),
    )
    row = cur.fetchone()
    if row:
        return str(row[0]), False
    key = r2_key(city, fetched_at, sha, content_type, url)
    if upload:
        upload(key, content, content_type)
    cur.execute(
        """insert into raw_document (jurisdiction_id, url, fetched_at, sha256, mime, size_bytes,
               r2_key, doc_type)
           values (%s, %s, %s, %s, %s, %s, %s, %s) returning id""",
        (
            jurisdiction_id,
            url,
            fetched_at,
            sha,
            (content_type or "application/octet-stream").split(";")[0].strip(),
            len(content),
            key if upload else None,
            doc_type,
        ),
    )
    created = cur.fetchone()
    assert created
    return str(created[0]), True
