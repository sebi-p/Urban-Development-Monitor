"""M5.3 against PostGIS: minutes are walked and stored once, their planning decisions are placed on
projects (or reviewed, or become projects), and statuses follow the council, not the listing."""

from datetime import UTC, date, datetime
from typing import Any

import httpx
import psycopg
import pytest

from mdu import decisions
from mdu.adapters.brasov import council_minutes, minutes
from mdu.core.http import PoliteClient
from mdu.core.streets import StreetIndex, StreetPoint
from mdu.fixtures import fixture_bytes
from mdu.ingest import IngestStats, ProjectRecord, SourceDoc, write_records
from mdu.linker import Profile, decide

STREETS = StreetIndex(
    {
        "morarului": StreetPoint("Strada Morarului", 25.57, 45.68),
        "13 decembrie": StreetPoint("Strada 13 Decembrie", 25.61, 45.668),
        "nicopole": StreetPoint("Strada Nicopole", 25.60, 45.65),
    }
)


def site(pdfs: dict[int, bytes]) -> tuple[PoliteClient, list[int]]:
    """The saved listing (numbers 449-468) and the given PDFs by number; anything else is 404."""
    listing = fixture_bytes("brasov", "council_minutes/listing")
    asked: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        url = str(request.url)
        if url == council_minutes.LISTING_URL:
            return httpx.Response(200, content=listing, headers={"content-type": "text/html"})
        n = int(url.rsplit("-", 1)[1].removesuffix(".pdf"))
        asked.append(n)
        if n in pdfs:
            return httpx.Response(200, content=pdfs[n], headers={"content-type": "application/pdf"})
        return httpx.Response(404, content=b"<html>not found</html>")

    client = PoliteClient(
        transport=httpx.MockTransport(handler), sleep=lambda _: None, min_interval=0
    )
    return client, asked


def pv(n: int) -> bytes:
    return fixture_bytes("brasov", f"council_minutes/pv-{n}")


def _brasov(pg: psycopg.Connection[Any]) -> None:
    pg.execute("update jurisdiction set slug = 'brasov' where slug = 'testcity'")


def listing_project(pg: psycopg.Connection[Any], title: str, street: str, status: str) -> str:
    rec = ProjectRecord(
        private_key=f"debate:{title[:20]}",
        title=title,
        official_title=title,
        kind="puz",
        status=status,  # type: ignore[arg-type]
        event_type="notice_published",
        event_date=date(2026, 6, 1),
        event_title="Anunț",
        source=SourceDoc("https://city.test/listing", 200, title.encode(), "text/html"),
        address_text=street,
        street=STREETS.points[street.lower().removeprefix("str. ")],
    )
    write_records(
        pg, city="brasov", adapter="brasov.council_debates", base_url="https://city.test/",
        records=[rec], upload=None, stats=IngestStats(),
    )  # fmt: skip
    row = pg.execute("select id::text from project where title = %s", (title,)).fetchone()
    assert row
    return str(row[0])


MORARULUI = (
    "PROIECT DE HOTĂRÂRE pentru aprobarea documentației de urbanism PUZ ”Zona de locuințe mixte "
    "și colective cu păstrarea avizelor din CU 1120/2022”, municipiul Brașov, str. Morarului FN"
)
DECEMBRIE = (
    "Proiect de hotărâre pentru aprobarea documentației de urbanism PUZ ”Construire locuințe "
    "colective și funcțiuni complementare” str. 13 Decembrie"
)


def test_walks_stores_once_and_stops_at_2020(
    pg: psycopg.Connection[Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    _brasov(pg)
    monkeypatch.setattr(minutes, "PER_RUN", 5)
    # 467 is the same file as 468; 448 holds the 2013 minutes, so the walk is past 2020 there.
    client, asked = site({468: pv(468), 467: pv(468), 465: pv(465), 448: pv(182)})
    counts = minutes.minutes_events(pg, client, None, STREETS)
    assert counts["minutes"] == 3
    assert counts["same PDF as another number"] == 1
    assert counts["history reached"] == 1
    assert asked[-1] == 448  # the walk stopped at the first minutes before 2020
    sessions = pg.execute(
        "select source_ref, session_date, session_type from council_session order by 1"
    ).fetchall()
    assert sessions == [
        ("PV-448", date(2013, 8, 30), "ordinară"),
        ("PV-465", date(2026, 7, 31), "ordinară"),
        ("PV-468", date(2026, 9, 25), "ordinară"),
    ]
    item = pg.execute(
        """select ai.item_text, ai.outcome::text, ai.votes_for, ai.votes_abstain, ai.unanimous,
                  ai.page, d.doc_type
           from agenda_item ai join council_session s on s.id = ai.session_id
           join raw_document d on d.id = ai.raw_document_id
           where s.source_ref = 'PV-468' and ai.item_number = 24"""
    ).fetchone()
    assert item is not None
    assert item[1:] == ("adopted", 16, 10, False, 6, "minutes")
    names = pg.execute("select string_agg(item_text, ' ') from agenda_item").fetchone()
    assert names is not None
    assert "Banciu" not in names[0]  # private initiators are stored as "persoană fizică"
    asked.clear()
    again = minutes.minutes_events(pg, client, None, STREETS)
    assert again["minutes"] == 0
    assert 448 not in asked  # history is complete: no walk


def test_decisions_place_create_review_and_keep_status(pg: psycopg.Connection[Any]) -> None:
    _brasov(pg)
    morarului = listing_project(pg, MORARULUI, "str. Morarului", "in_preparation")
    pg.execute("update project set initiator = 'SC INSIGRA SRL' where id = %s", (morarului,))
    decembrie = listing_project(pg, DECEMBRIE, "str. 13 Decembrie", "expired")
    client, _ = site({468: pv(468), 465: pv(465)})
    minutes.minutes_events(pg, client, None, STREETS)

    first = decisions.run(pg, city="brasov", streets=STREETS, facts=minutes.facts)
    assert first.counts["placed"] == 1  # PV-468 #24: same street, title and company
    assert first.counts["for review"] == 1  # PV-465 #67: same street and title, no company
    event = pg.execute(
        """select event_type::text, title, details->>'page', details->>'source_url'
           from project_event where project_id = %s and details->>'kind' = 'council_decision'""",
        (morarului,),
    ).fetchone()
    assert event is not None
    assert event[:3] == (
        "council_vote",
        "Aprobat în ședința Consiliului Local din 25.09.2026 (16 pentru, 10 abțineri)",
        "6",
    )
    assert event[3].endswith("CMBV-PV-468.pdf#page=6")
    status = pg.execute("select status::text from project where id = %s", (morarului,)).fetchone()
    assert status == ("approved",)
    # Plans no project knows become projects, except private homes and private initiators.
    made = pg.execute(
        """select p.title, p.status::text from project p join project_event e
           on e.project_id = p.id and e.details->>'kind' = 'decision_project' order by 1"""
    ).fetchall()
    titles = [t for t, _ in made]
    assert any(t.startswith("Construire corp nou de clădire") for t in titles)  # a hospital
    assert all(s == "approved" for _, s in made)
    assert not any("Banciu" in t or "unifamilial" in t for t in titles)

    # Idempotent: the same events and projects again.
    counts = pg.execute("select count(*) from project_event").fetchone()
    projects = pg.execute("select count(*) from project").fetchone()
    second = decisions.run(pg, city="brasov", streets=STREETS, facts=minutes.facts)
    assert second.counts["waiting for review"] == 1
    assert pg.execute("select count(*) from project_event").fetchone() == counts
    assert pg.execute("select count(*) from project").fetchone() == projects

    # The listing still shows the plan in preparation: the council's decision stays.
    listing_project(pg, MORARULUI, "str. Morarului", "in_preparation")
    status = pg.execute("select status::text from project where id = %s", (morarului,)).fetchone()
    assert status == ("approved",)
    changes = pg.execute(
        """select count(*) from project_event where project_id = %s
           and details->>'kind' = 'status_change'""",
        (morarului,),
    ).fetchone()
    assert changes == (0,)  # the council_vote event tells the change; the listing adds none

    # A reviewer approves the pending pair (what /admin does); the next run writes the event.
    pg.execute(
        """update agenda_item set project_id = c.candidate_project_id
           from link_candidate c where c.subject = 'minutes:' || agenda_item.id::text
             and c.state = 'pending_review'"""
    )
    pg.execute("update link_candidate set state = 'approved' where state = 'pending_review'")
    decisions.run(pg, city="brasov", streets=STREETS, facts=minutes.facts)
    status = pg.execute("select status::text from project where id = %s", (decembrie,)).fetchone()
    assert status == ("approved",)


def test_a_project_made_from_the_minutes_joins_the_listing_project() -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    common: dict[str, Any] = {"kind": "puz", "street": "lunga", "initiator": "X SRL"}
    made = Profile(
        subject="project:a", source="", title="Zona de locuințe, str. Lungă", project_id="a",
        stage=5, first_seen=now, from_decisions=True, **common,
    )  # fmt: skip
    notice = Profile(
        subject="project:b", source="brasov.notices", title="Zona de locuințe", project_id="b",
        stage=1, first_seen=now, **common,
    )  # fmt: skip
    [d] = decide([made, notice])
    assert (d.action, d.subject.subject, d.target.subject if d.target else None) == (
        "merge",
        "project:a",
        "project:b",
    )
