"""M2.2 acceptance: re-running a stage is a no-op. Real PostGIS, simulated HTTP, memory store."""

from datetime import UTC, datetime
from typing import Any

import httpx
import psycopg

from mdu.core.http import PoliteClient
from mdu.stages import DiscoveredItem, discover, fetch, is_night

PDF_A = b"%PDF-1.7 document A"
PDF_B = b"%PDF-1.7 document B"


class Site:
    """Simulated municipal site with ETags; counts the requests per path."""

    def __init__(self) -> None:
        self.files = {
            "/a.pdf": PDF_A,
            "/b.pdf": PDF_B,
            "/copy-of-a.pdf": PDF_A,
            "/huge.pdf": b"x" * 5000,
        }
        self.hits: dict[str, int] = {}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.hits[path] = self.hits.get(path, 0) + 1
        if path == "/robots.txt":
            return httpx.Response(404)
        body = self.files.get(path)
        if body is None:
            return httpx.Response(404)
        etag = f'"{hash(body)}"'
        if request.headers.get("if-none-match") == etag:
            return httpx.Response(304, headers={"etag": etag})
        return httpx.Response(
            200, content=body, headers={"etag": etag, "content-type": "application/pdf"}
        )


class Store:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put(self, key: str, data: bytes, content_type: str | None = None) -> None:
        self.objects[key] = data


def client(site: Site) -> PoliteClient:
    return PoliteClient(transport=httpx.MockTransport(site), sleep=lambda _: None, min_interval=0)


ITEMS = [
    DiscoveredItem(f"https://city.test{p}", {"label": p})
    for p in ("/a.pdf", "/b.pdf", "/copy-of-a.pdf", "/huge.pdf", "/gone.pdf")
]


def count(conn: psycopg.Connection[Any], sql: str) -> int:
    row = conn.execute(sql).fetchone()  # type: ignore[call-overload]
    assert row
    return int(row[0])


def run_discover(conn: psycopg.Connection[Any]) -> dict[str, int]:
    return dict(
        discover(
            conn,
            city="testcity",
            adapter="testcity.docs",
            base_url="https://city.test",
            items=ITEMS,
        ).counts
    )


def test_discover_twice_queues_each_url_once(pg: psycopg.Connection[Any]) -> None:
    assert run_discover(pg) == {"queued": 5}
    assert run_discover(pg) == {"already_known": 5}
    assert count(pg, """select count(*) from "fetch" where status = 'pending'""") == 5


def test_fetch_stores_once_per_hash_and_rerun_is_a_no_op(pg: psycopg.Connection[Any]) -> None:
    site, store = Site(), Store()
    run_discover(pg)
    first = fetch(pg, client(site), city="testcity", upload=store.put, max_bytes=1000)
    assert dict(first.counts) == {"fetched": 3, "skipped": 1, "failed": 1}
    # Three URLs fetched but only two distinct documents: the copy at a second URL links to the
    # same raw_document row and R2 object.
    assert count(pg, "select count(*) from raw_document") == 2
    assert len(store.objects) == 2
    assert all(k.startswith("raw/testcity/") for k in store.objects)
    assert (
        count(pg, """select count(distinct raw_document_id) from "fetch" where url like '%a.pdf'""")
        == 1
    )

    hits = dict(site.hits)
    second = fetch(pg, client(site), city="testcity", upload=store.put, max_bytes=1000)
    assert sum(second.counts.values()) == 0  # nothing pending
    assert second.requests == 0
    assert site.hits == hits
    # Discover again: only the failed URL comes back; the rest are known.
    assert run_discover(pg) == {"queued": 1, "already_known": 4}


def test_refetch_uses_conditional_get_and_creates_nothing(pg: psycopg.Connection[Any]) -> None:
    site, store = Site(), Store()
    run_discover(pg)
    fetch(pg, client(site), city="testcity", upload=store.put, max_bytes=1000)
    # Queue a.pdf again (as the monthly re-verify will).
    pg.execute(
        """insert into "fetch" (jurisdiction_id, source_id, url, status)
           select jurisdiction_id, source_id, url, 'pending' from "fetch"
           where url = 'https://city.test/a.pdf' limit 1"""
    )
    again = fetch(pg, client(site), city="testcity", upload=store.put, max_bytes=1000)
    assert dict(again.counts) == {"unchanged": 1}
    assert count(pg, "select count(*) from raw_document") == 2
    assert count(pg, """select count(*) from "fetch" where http_status = 304""") == 1


def test_files_listed_as_too_large_are_skipped_without_a_request(
    pg: psycopg.Connection[Any],
) -> None:
    site = Site()
    discover(
        pg,
        city="testcity",
        adapter="testcity.docs",
        base_url="https://city.test",
        items=[DiscoveredItem("https://city.test/huge.pdf", {"size_bytes": 10_000_000})],
    )
    result = fetch(pg, client(site), city="testcity", upload=None, max_bytes=1000)
    assert dict(result.counts) == {"skipped": 1}
    assert "/huge.pdf" not in site.hits


def test_each_run_is_logged(pg: psycopg.Connection[Any]) -> None:
    run_discover(pg)
    fetch(pg, client(Site()), city="testcity", upload=None, max_bytes=1000)
    assert count(pg, "select count(*) from pipeline_run where stage in ('discover', 'fetch')") == 2


def test_night_window_is_bucharest_time() -> None:
    assert is_night(datetime(2026, 11, 20, 21, 0, tzinfo=UTC))  # 23:00 in Bucharest
    assert not is_night(datetime(2026, 11, 20, 10, 0, tzinfo=UTC))  # 12:00
    assert is_night(datetime(2026, 7, 1, 2, 30, tzinfo=UTC))  # 05:30 summer time
