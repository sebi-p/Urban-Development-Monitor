"""`mdu backfill` (PLAN §10, M5.1; ADR 0018): history the listings no longer show.

Walks a numbered source (`Adapter.backfill`) from its newest number downwards, newest first, until
it has passed the `since` date: projects are written like the listings write them and their
documents are queued for the daily stages (fetch, text, classify, fields, …), which then work
through the queue under their usual limits and the monthly AI budget.

The walk is time-boxed (one night) and checkpointed every `CHECKPOINT` numbers in `pipeline_run`
(stage `backfill`): the next run resumes there, and a crash repeats at most one checkpoint, which
is harmless because every write is an upsert. Each checkpoint also counts what it found per year,
so the shards (years) can be followed with `mdu backfill --status`. Re-running after the walk is
done changes nothing; an earlier `since` resumes it.
"""

from __future__ import annotations

import json
import time
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import psycopg

from mdu import stages
from mdu.core.adapter import Adapter, Walked
from mdu.core.http import PoliteClient
from mdu.core.streets import StreetIndex
from mdu.ingest import IngestStats, ProjectRecord, write_records

CHECKPOINT = 100  # numbers between saves
# The walk is done after this many articles in a row dated before `since`: dates are not strictly
# in number order (an article can be backdated), so one old article doesn't end it.
OLDER_IN_A_ROW = 40


@dataclass
class Cursor:
    next_id: int
    since: date
    done: bool = False
    walked: int = 0
    older_in_a_row: int = 0
    years: dict[str, Counter[str]] = field(default_factory=dict)

    def as_json(self) -> str:
        return json.dumps(
            {
                "next_id": self.next_id,
                "since": self.since.isoformat(),
                "done": self.done,
                "walked": self.walked,
                "older_in_a_row": self.older_in_a_row,
                "years": {y: dict(c) for y, c in sorted(self.years.items())},
            }
        )

    def count(self, published: date | None, key: str) -> None:
        year = str(published.year) if published else "unknown"
        self.years.setdefault(year, Counter())[key] += 1


def load_cursor(conn: psycopg.Connection[Any], city: str, adapter: str) -> Cursor | None:
    """The latest checkpoint. Read in its own transaction: a bare read on a connection that isn't
    in autocommit leaves one open, and the night's checkpoints would then be savepoints in it,
    committed only at the end. The walked count breaks ties (rows written in one transaction share
    `now()`), as it only grows."""
    with conn.transaction():
        row = conn.execute(
            """select r.stats from pipeline_run r join jurisdiction j on j.id = r.jurisdiction_id
               where j.slug = %s and r.adapter = %s and r.stage = 'backfill'
               order by r.started_at desc, (r.stats->>'walked')::int desc nulls last, r.id desc
               limit 1""",
            (city, adapter),
        ).fetchone()
    if row is None:
        return None
    s = row[0]
    return Cursor(
        next_id=int(s["next_id"]),
        since=date.fromisoformat(s["since"]),
        done=bool(s["done"]),
        walked=int(s.get("walked", 0)),
        older_in_a_row=int(s.get("older_in_a_row", 0)),
        years={y: Counter(c) for y, c in (s.get("years") or {}).items()},
    )


def _save(conn: psycopg.Connection[Any], city: str, adapter: str, cursor: Cursor) -> None:
    with conn.transaction():
        conn.execute(
            """insert into pipeline_run (jurisdiction_id, adapter, stage, status, started_at,
                   finished_at, stats)
               select id, %s, 'backfill', 'succeeded', clock_timestamp(), clock_timestamp(), %s
               from jurisdiction where slug = %s""",
            (adapter, cursor.as_json(), city),
        )


def record_night(
    conn: psycopg.Connection[Any],
    city: str,
    *,
    done: bool,
    walked: int,
    error: str | None = None,
) -> None:
    """One `backfill_night` row per run: the watchdog alerts on a missed or failed night while
    the walk isn't done (M5.4). The checkpoint rows (`backfill`) stay the walk's own state."""
    with conn.transaction():
        conn.execute(
            """insert into pipeline_run (jurisdiction_id, stage, status, finished_at, error, stats)
               select id, 'backfill_night', %s, now(), %s, %s from jurisdiction where slug = %s""",
            (
                "failed" if error else "succeeded",
                error[:2000] if error else None,
                json.dumps({"done": done, "walked": walked}),
                city,
            ),
        )


@dataclass
class BackfillResult:
    cursor: Cursor
    walked: int = 0  # this run
    projects: int = 0
    documents: int = 0
    skipped: dict[str, int] = field(default_factory=dict)


def run(  # noqa: PLR0913
    conn: psycopg.Connection[Any],
    client: PoliteClient,
    streets: StreetIndex,
    adapter: Adapter,
    *,
    city: str,
    since: date,
    seconds: float,
    upload: Callable[[str, bytes, str | None], None] | None,
    clock: Callable[[], float] = time.monotonic,
    log: Callable[[str], None] = lambda _: None,
) -> BackfillResult:
    walk = adapter.backfill
    if walk is None:
        raise ValueError(f"{adapter.key} has no back-fill")
    cursor = load_cursor(conn, city, adapter.key)
    if cursor is None:
        cursor = Cursor(next_id=walk.start(client), since=since)
        log(f"{adapter.key}: starting at number {cursor.next_id}")
    elif since < cursor.since:  # going further back than before
        cursor.since, cursor.done, cursor.older_in_a_row = since, False, 0
    result = BackfillResult(cursor)
    if cursor.done:
        log(f"{adapter.key}: done back to {cursor.since}")
        return result

    stats = IngestStats()
    records: list[ProjectRecord] = []
    items: list[stages.DiscoveredItem] = []

    def flush() -> None:  # one transaction: what the checkpoint found, then the checkpoint
        with conn.transaction():
            _flush()

    def _flush() -> None:
        if records:
            write_records(
                conn, city=city, adapter=adapter.key, base_url=adapter.base_url,
                records=records, upload=upload, stats=stats,
            )  # fmt: skip
            result.projects += len(records)
        if items:
            stages.discover(
                conn, city=city, adapter=adapter.key, base_url=adapter.base_url,
                items=adapter.mark_never_mirror(items),
            )  # fmt: skip
            result.documents += len(items)
        records.clear()
        items.clear()
        _save(conn, city, adapter.key, cursor)

    deadline = clock() + seconds
    since_save = 0
    while cursor.next_id > 0 and clock() < deadline:
        found = walk.read(client, streets, stats, cursor.next_id)
        _take(cursor, found, records, items)
        result.walked += 1
        since_save += 1
        if cursor.older_in_a_row >= OLDER_IN_A_ROW:
            cursor.done = True
            break
        if since_save >= CHECKPOINT:
            flush()
            since_save = 0
            log(f"{adapter.key}: next {cursor.next_id}, {_progress(cursor)}")
    cursor.done = cursor.done or cursor.next_id <= 0
    flush()
    result.skipped = {**stats.skipped_other, "personal": stats.skipped_personal}
    return result


def _take(
    cursor: Cursor,
    found: Walked,
    records: list[ProjectRecord],
    items: list[stages.DiscoveredItem],
) -> None:
    """Moves the cursor past one number and keeps what it held."""
    cursor.next_id -= 1
    cursor.walked += 1
    if found.found:
        cursor.count(found.published, "articles")
        if found.published is not None and found.published < cursor.since:
            cursor.older_in_a_row += 1
        elif found.published is not None:
            cursor.older_in_a_row = 0
    if found.record is not None:
        cursor.count(found.published, "projects")
        records.append(found.record)
        items.extend(found.items)


def _progress(cursor: Cursor) -> str:
    years = [y for y in cursor.years if y != "unknown"]
    return f"walked {cursor.walked}, back to {min(years) if years else '?'}"


def status(conn: psycopg.Connection[Any], city: str, adapters: list[Adapter]) -> list[str]:
    """One line per adapter and per year: articles found and projects written."""
    lines = []
    for a in adapters:
        if a.backfill is None:
            continue
        c = load_cursor(conn, city, a.key)
        if c is None:
            lines.append(f"{a.key}: not started")
            continue
        state = "done" if c.done else f"next number {c.next_id}"
        lines.append(f"{a.key}: back to {c.since}, {state}, {c.walked} numbers walked")
        for year, counts in sorted(c.years.items(), reverse=True):
            lines.append(
                f"  {year}: {counts['articles']} articles, {counts['projects']} PUZ/PUD notices"
            )
    return lines
