"""M2.4–M2.7: the four daily Brașov adapters on saved fixtures (no live requests)."""

from datetime import date

import httpx

from mdu.adapters.brasov import agendas, council_agendas, council_debates, urbanism_hub
from mdu.adapters.brasov.discover import debate_documents, hub_documents
from mdu.adapters.brasov.ingest import debate_records
from mdu.adapters.brasov.registry import ADAPTERS, DAILY, REGISTERS
from mdu.core.http import PoliteClient
from mdu.core.streets import StreetIndex
from mdu.fixtures import fixture_bytes
from mdu.ingest import IngestStats, SourceDoc


def site(pages: dict[str, bytes]) -> PoliteClient:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        body = pages.get(str(request.url))
        if body is None:
            return httpx.Response(404)
        return httpx.Response(200, content=body, headers={"content-type": "text/html"})

    return PoliteClient(
        transport=httpx.MockTransport(handler), sleep=lambda _: None, min_interval=0
    )


def test_registry_runs_projects_before_agendas() -> None:
    assert set(DAILY) == set(ADAPTERS)
    assert DAILY.index("brasov.council_agendas") > DAILY.index("brasov.council_debates")
    assert all(a.city == "brasov" for a in ADAPTERS.values())


def test_debate_registers_of_opinions_are_never_mirrored() -> None:
    listing = fixture_bytes("brasov", "council_debates/listing")
    adapter = ADAPTERS["brasov.council_debates"]
    with site({council_debates.LISTING_URL: listing}) as client:
        items = adapter.mark_never_mirror(debate_documents(client, include_all=True))
    flagged = [i for i in items if "never_mirror" in i.hints]
    assert len(flagged) == 5
    assert all(REGISTERS.matches(i.hints["label"]) for i in flagged)
    assert not any(REGISTERS.matches(i.hints["label"]) for i in items if i not in flagged)
    assert REGISTERS.matches("07. Registru opinii")
    assert not REGISTERS.matches("03. Referat de aprobare")


def test_hub_queues_plans_and_ctatu_but_not_traffic_or_folder_names() -> None:
    page = fixture_bytes("brasov", "urbanism_hub/page")
    with site({urbanism_hub.PAGE_URL: page}) as client:
        items = hub_documents(client)
    kinds = {i.hints["kind"] for i in items}
    assert kinds == {"pud", "puz", "ctatu"}
    assert len(items) == 64
    folders = {f.group for f in urbanism_hub.parse_page(page)}
    for item in items:
        assert len(item.hints["group"]) == 10
        assert item.hints["group"] not in folders


def test_agenda_items_are_parsed_from_the_main_content() -> None:
    agenda = council_agendas.parse_agenda(fixture_bytes("brasov", "council_agendas/session-470"))
    assert agenda is not None
    assert agenda.session_date == date(2026, 11, 20)
    assert [e.number for e in agenda.entries] == list(range(1, agenda.items + 1))
    assert agenda.entries[0].title.startswith("Aprobarea procesului")
    assert council_agendas.session_id_of(council_agendas.agenda_url(470)) == 470


def test_title_key_matches_agenda_and_debate_wording() -> None:
    agenda_title = (
        "Proiect de hotărâre pentru aprobarea documentației de urbanism P.U.Z. ”Construire "
        "biserică”, în mun. Brașov, str. Albinelor f.n., inițiator PAROHIA X"
    )
    debate_title = (
        "PROIECT DE HOTĂRÂRE AL CONSILIULUI LOCAL pentru aprobarea documentației de urbanism "
        "PUZ ”Construire biserică”, în municipiul Brașov, str. Albinelor f.n."
    )
    key = council_agendas.title_key(agenda_title)
    assert key == council_agendas.title_key(debate_title)
    assert key.startswith("aprobarea documentatiei de urbanism puz construire biserica")


def test_agenda_names_the_debates_sent_on_to_the_council() -> None:
    listing = SourceDoc(
        council_debates.LISTING_URL,
        200,
        fixture_bytes("brasov", "council_debates/listing"),
        "text/html",
    )
    records = debate_records(listing, StreetIndex({}), IngestStats())
    titles = [(r.private_key, r.official_title) for r in records]
    agenda = council_agendas.parse_agenda(fixture_bytes("brasov", "council_agendas/session-470"))
    assert agenda is not None
    events = agendas.matches(agenda, 470, titles)
    matched = {r.private_key: r for r in records if r.private_key in {e.project_id for e in events}}
    assert len(events) == 2
    assert {r.status for r in matched.values()} == {"expired"}  # debate closed -> council
    for e in events:
        assert e.event_type == "council_agenda"
        assert e.event_date == date(2026, 11, 20)
        assert e.title == "Pe ordinea de zi a ședinței din 20.11.2026"
    # A key shared by two projects is ambiguous and matches nothing.
    first = events[0].project_id
    duplicate = [*titles, ("other", dict(titles)[first])]
    assert [e.project_id for e in agendas.matches(agenda, 470, duplicate)] == [
        e.project_id for e in events if e.project_id != first
    ]
