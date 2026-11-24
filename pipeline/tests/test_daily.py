"""M2.4–M2.7: status history, listing events, never-mirrored files and the daily run.
Real PostGIS, a simulated site and an in-memory store."""

import re
from collections import Counter
from datetime import date
from typing import Any

import httpx
import psycopg
import pymupdf

from mdu import daily
from mdu.core.adapter import Adapter, NeverMirror
from mdu.core.http import PoliteClient
from mdu.core.streets import StreetIndex
from mdu.ingest import (
    EventRecord,
    IngestStats,
    ProjectRecord,
    SourceDoc,
    project_titles,
    write_events,
    write_records,
)
from mdu.stages import DiscoveredItem, discover, fetch


def pdf(text: str) -> bytes:
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), text)
    data: bytes = doc.tobytes()
    return data


class Site:
    def __init__(self) -> None:
        self.files = {
            "/listing": b"<html>listing</html>",
            "/memoriu.pdf": pdf("Memoriu tehnic PUZ"),
            "/registru.pdf": pdf("Registru opinii: persoane"),
        }
        self.hits: Counter[str] = Counter()

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.hits[request.url.path] += 1
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        body = self.files.get(request.url.path)
        if body is None:
            return httpx.Response(404)
        kind = "application/pdf" if request.url.path.endswith(".pdf") else "text/html"
        return httpx.Response(200, content=body, headers={"content-type": kind, "etag": '"1"'})


class Store:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put(self, key: str, data: bytes, content_type: str | None = None) -> None:
        self.objects[key] = data

    def get(self, key: str) -> bytes:
        return self.objects[key]


def client(site: Site) -> PoliteClient:
    return PoliteClient(transport=httpx.MockTransport(site), sleep=lambda _: None, min_interval=0)


def record(status: Any, status_text: str) -> ProjectRecord:
    return ProjectRecord(
        private_key="debate:x",
        title="PUZ Strada Test",
        official_title="Proiect de hotărâre pentru aprobarea PUZ Strada Test",
        kind="puz",
        status=status,
        event_type="consultation_opened",
        event_date=date(2026, 10, 1),
        event_title="Publicat în dezbatere publică",
        source=SourceDoc("https://city.test/listing", 200, b"<html>listing</html>", "text/html"),
        status_text=status_text,
    )


def events(conn: psycopg.Connection[Any]) -> list[tuple[Any, ...]]:
    return conn.execute(
        "select event_date, event_type, title, details->>'kind' from project_event "
        "order by event_date, created_at"
    ).fetchall()


def write(conn: psycopg.Connection[Any], rec: ProjectRecord, seen_on: date) -> None:
    write_records(
        conn,
        city="testcity",
        adapter="testcity.debates",
        base_url="https://city.test",
        records=[rec],
        upload=Store().put,
        stats=IngestStats(),
        seen_on=seen_on,
    )


def test_a_status_change_is_kept_as_a_dated_event(pg: psycopg.Connection[Any]) -> None:
    write(pg, record("in_public_consultation", "În dezbatere publică"), date(2026, 10, 1))
    write(pg, record("in_public_consultation", "În dezbatere publică"), date(2026, 10, 2))
    assert len(events(pg)) == 1  # same status: nothing new
    write(pg, record("expired", "Termen expirat conform legii"), date(2026, 11, 3))
    write(pg, record("expired", "Termen expirat conform legii"), date(2026, 11, 4))
    assert events(pg) == [
        (date(2026, 10, 1), "consultation_opened", "Publicat în dezbatere publică", "listing"),
        (date(2026, 11, 3), "consultation_closed", "Termen expirat conform legii", "status_change"),
    ]
    status = pg.execute("select status from project").fetchone()
    assert status == ("expired",)


def test_listing_events_are_replaced_per_group(pg: psycopg.Connection[Any]) -> None:
    write(pg, record("expired", "Termen expirat conform legii"), date(2026, 11, 3))
    [(pid, title)] = project_titles(pg, "testcity")
    assert title.startswith("Proiect de hotărâre")
    agenda = SourceDoc("https://city.test/agenda/470", 200, b"<html>agenda</html>", "text/html")
    ev = EventRecord(pid, date(2026, 11, 20), "council_agenda", "Pe ordinea de zi")
    for _ in range(2):
        write_events(
            pg,
            city="testcity",
            adapter="testcity.agendas",
            base_url="https://city.test/agenda",
            source=agenda,
            doc_type="agenda",
            group="session:470",
            events=[ev],
            upload=Store().put,
        )
    assert [e[1:] for e in events(pg)][-1] == ("council_agenda", "Pe ordinea de zi", "event")
    assert len(events(pg)) == 2
    docs = pg.execute("select count(*) from raw_document where doc_type = 'agenda'").fetchone()
    assert docs == (1,)


def test_never_mirrored_files_are_skipped_without_a_request(pg: psycopg.Connection[Any]) -> None:
    site = Site()
    adapter = Adapter(
        "testcity.debates",
        "https://city.test",
        never_mirror=(NeverMirror(re.compile("registru", re.I), "register of comments"),),
    )
    items = adapter.mark_never_mirror(
        [
            DiscoveredItem("https://city.test/memoriu.pdf", {"label": "Memoriu"}),
            DiscoveredItem("https://city.test/registru.pdf", {"label": "07. Registru opinii"}),
        ]
    )
    discover(pg, city="testcity", adapter=adapter.key, base_url=adapter.base_url, items=items)
    result = fetch(pg, client(site), city="testcity", upload=Store().put)
    assert dict(result.counts) == {"fetched": 1, "skipped": 1}
    assert site.hits["/registru.pdf"] == 0
    row = pg.execute("""select error from "fetch" where url like '%registru.pdf'""").fetchone()
    assert row == ("never mirrored: register of comments",)


def test_daily_runs_every_step_isolates_failures_and_reruns_as_no_op(
    pg: psycopg.Connection[Any],
) -> None:
    site, store = Site(), Store()

    def projects(c: PoliteClient, streets: StreetIndex, stats: IngestStats) -> list[ProjectRecord]:
        c.get("https://city.test/listing")
        return [record("in_public_consultation", "În dezbatere publică")]

    def find(c: PoliteClient, *, include_all: bool = False) -> list[DiscoveredItem]:
        return [
            DiscoveredItem("https://city.test/memoriu.pdf", {"label": "Memoriu"}),
            DiscoveredItem("https://city.test/registru.pdf", {"label": "Registru opinii"}),
        ]

    def broken(c: PoliteClient, *, include_all: bool = False) -> list[DiscoveredItem]:
        raise RuntimeError("listing redesigned")

    adapters = [
        Adapter(
            "testcity.debates",
            "https://city.test",
            projects=projects,
            discover=find,
            never_mirror=(NeverMirror(re.compile("registru", re.I), "register"),),
        ),
        Adapter("testcity.hub", "https://city.test/hub", discover=broken),
    ]

    def run() -> daily.DailyResult:
        return daily.run(pg, client(site), store, StreetIndex({}), adapters, city="testcity")

    first = run()
    assert first.failed == ["testcity.hub discover"]
    assert first.steps["testcity.debates projects"]["projects"] == 1
    assert first.steps["testcity.debates discover"] == {"queued": 2}
    assert first.steps["fetch"]["fetched"] == 1
    assert first.steps["fetch"]["skipped"] == 1
    assert first.steps["extract"]["extracted"] == 1
    failed = pg.execute(
        "select adapter, stage, error from pipeline_run where status = 'failed' order by stage desc"
    ).fetchall()
    assert failed == [
        ("testcity.hub", "discover", "RuntimeError: listing redesigned"),
        # The run's own row, which the watchdog reads (M5.4).
        (None, "daily", "testcity.hub discover: RuntimeError: listing redesigned"),
    ]

    pdf_hits = site.hits["/memoriu.pdf"]
    second = run()
    assert second.steps["testcity.debates discover"] == {"already_known": 2}
    assert second.steps["fetch"] == {"requests": 0}
    assert second.steps["extract"] == {}
    assert site.hits["/memoriu.pdf"] == pdf_hits
    assert site.hits["/registru.pdf"] == 0
    assert len(events(pg)) == 1
