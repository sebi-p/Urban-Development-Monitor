"""M5.3 acceptance: council minutes give golden-set projects the right session date, outcome,
votes and status (tests/fixtures/brasov/minutes_golden.json, checked by hand)."""

import json
from datetime import date
from typing import Any

import pytest
from test_linker import golden as linker_golden

from mdu import decisions
from mdu.adapters.brasov import council_minutes as cm
from mdu.adapters.brasov.minutes import facts
from mdu.core.extract import raw_page_texts
from mdu.core.streets import StreetIndex, StreetPoint
from mdu.fixtures import FixtureSet, fixture_bytes
from mdu.linker import Profile

GOLDEN = json.loads((FixtureSet("brasov").dir / "minutes_golden.json").read_text("utf-8"))


def pages_of(name: str) -> list[str]:
    content = fixture_bytes("brasov", f"council_minutes/{name}")
    return raw_page_texts(content)


@pytest.fixture(scope="module")
def parsed() -> dict[str, cm.Minutes]:
    return {name: cm.parse_minutes(pages_of(name)) for name in GOLDEN["minutes"]}


def test_every_planning_item_with_its_outcome_votes_and_page(parsed: dict[str, cm.Minutes]) -> None:
    for name, expected in GOLDEN["minutes"].items():
        m = parsed[name]
        assert m.session_date == date.fromisoformat(expected["session_date"]), name
        got = [
            {
                "number": i.number,
                "kind": i.kind,
                "outcome": i.vote.outcome,
                "votes": [
                    i.vote.votes_for,
                    i.vote.votes_against,
                    i.vote.votes_abstain,
                    i.vote.votes_absent,
                ],
                "unanimous": i.vote.unanimous,
                "page": i.page,
            }
            for i in m.items
        ]
        assert got == expected["items"], name


def _projects() -> tuple[list[Profile], StreetIndex]:
    profiles, _ = linker_golden()
    projects = [p for p in profiles if p.project_id]
    # The streets the golden projects are on, so the items' streets are read the same way.
    streets = StreetIndex(
        {
            p.street: StreetPoint(f"Strada {p.street.title()}", *p.point)
            for p in projects
            if p.street and p.point
        }
    )
    return projects, streets


def _decisions(parsed: dict[str, cm.Minutes]) -> list[tuple[str, date, int, Any, str, str | None]]:
    """(item ref, session date, number, outcome, action, golden project) for every item."""
    projects, streets = _projects()
    out = []
    for name, m in parsed.items():
        assert m.session_date
        for i in m.items:
            ref = f"{name}#{i.number}"
            stored = decisions.StoredItem(
                id=ref, text=i.text, outcome=i.vote.outcome, votes_for=None, votes_against=None,
                votes_abstain=None, votes_absent=None, unanimous=False, page=i.page,
                project_id=None, item_number=i.number, session_date=m.session_date,
                session_ref=name, raw_document_id=None, url=None,
            )  # fmt: skip
            profile = decisions.item_profile(stored, facts(i.text), streets)
            action, target, _, _ = decisions.decide(profile, projects, frozenset(), i.vote.outcome)
            out.append((ref, m.session_date, i.number, i.vote.outcome, action,
                        target.subject if target else None))  # fmt: skip
    return out


def test_golden_projects_get_their_decisions_and_status(parsed: dict[str, cm.Minutes]) -> None:
    found = _decisions(parsed)
    expected = GOLDEN["projects"]
    for subject, want in expected.items():
        placed = sorted(ref for ref, *_, action, s in found if s == subject and action == "place")
        review = sorted(ref for ref, *_, action, s in found if s == subject and action == "review")
        assert placed == want["placed"], subject
        assert review == want["review"], subject
        # As a back-filled notice would be stored: in preparation until the council decides.
        for after_review, status in zip((False, True), want["status"], strict=True):
            mine = [f for f in found if f[5] == subject and (f[4] == "place" or after_review)]
            latest = max(mine, key=lambda f: (f[1], f[2]), default=None)
            outcome = latest[3] if latest else None
            got = decisions.next_status("in_preparation", outcome) if outcome else None
            assert (got or "in_preparation") == status, (subject, after_review)
    # No other item is placed on, or offered for, a golden-set project.
    others = [f for f in found if f[5] and f[5] not in expected and f[4] in ("place", "review")]
    assert others == []


def test_statuses_never_go_back() -> None:
    assert decisions.next_status("in_preparation", "adopted") == "approved"
    assert decisions.next_status("expired", "rejected") == "rejected"
    assert decisions.next_status("approved", "withdrawn") is None  # a later change was withdrawn
    assert decisions.next_status("rejected", "adopted") == "approved"  # adopted after all
    assert decisions.next_status("permitted", "adopted") is None
    assert decisions.next_status("in_preparation", "postponed") is None


def test_votes_in_words_brackets_and_headings() -> None:
    v = cm.read_vote(
        "iar în urma votului a fost aprobat cu unanimitate (23 de voturi pentru și două "
        "neparticipări)."
    )
    assert (v.outcome, v.unanimous, v.votes_for, v.votes_absent) == ("adopted", True, 23, 2)
    v = cm.read_vote("a fost aprobat cu unanimitate. (22 voturi pentru şi 3 neparticipări).")
    assert (v.votes_for, v.votes_absent) == (22, 3)
    v = cm.read_vote("a fost adoptat cu 14 voturi pentru, 1, împotriva si 11 abtineri.")
    assert (v.votes_for, v.votes_against, v.votes_abstain) == (14, 1, 11)
    v = cm.read_vote("Proiectul a fost avizat favorabil și nu a fost adoptat (12 voturi pentru).")
    assert v.outcome == "rejected"
    v = cm.read_vote("Se supune la vot amendamentul și se aprobă. Proiectul a fost retras.")
    assert v.outcome == "withdrawn"
    assert cm.read_vote("Proiectul a fost avizat favorabil de comisia 2.").outcome is None


def test_heading_outcome_and_items_at_the_top_of_a_page() -> None:
    title = "Proiect de hotărâre privind aprobarea documentației de urbanism ”P.U.D. - Casă”"
    pages = [
        "PROCESUL - VERBAL încheiat în ședința ordinară din data de 30 ianuarie 2026\n"
        + "x " * 120,
        f"PUNCTUL 7 - RETRAS\n7. {title}, str. Lungă.\n\n12",
        f"8. {title.replace('Casă', 'Hotel')}, inițiator X S.R.L.\n"
        "Proiectul de hotărâre a fost adoptat cu unanimitate de voturi.",
    ]
    m = cm.parse_minutes(pages)
    assert (m.session_date, m.session_type) == (date(2026, 1, 30), "ordinară")
    assert [(i.number, i.vote.outcome, i.page) for i in m.items] == [
        (7, "withdrawn", 2),
        (8, "adopted", 3),
    ]
    assert "12" not in m.items[0].text  # the page number isn't part of the title


def test_private_initiators_are_not_kept() -> None:
    title = (
        "Proiect de hotărâre pentru aprobarea documentației de urbanism ”P.U.D. - Construire "
        "locuință unifamilială”, str. Merilor nr. 3, având ca inițiator pe Popescu Ion."
    )
    assert cm.redact(title).endswith("având ca inițiator pe persoană fizică.")
    assert cm.initiator(title) is None
    company = title.replace("Popescu Ion", "Ionescu Maria prin SIGMET TRANS S.R.L")
    assert cm.redact(company).endswith("pe SIGMET TRANS S.R.L.")
    assert cm.initiator(company) == "Ionescu Maria prin SIGMET TRANS S.R.L"
    assert cm.plan_title(company) == "Construire locuință unifamilială, str. Merilor nr. 3"


def test_session_date_ignores_later_dates() -> None:
    head = (
        "PROCESUL – VERBAL încheiat în ședința ordinară a Consiliului Local Brașov\n"
        "din  28 noiembrie 2023\nȘedința a fost convocată ... HCL din data de 17 iunie 2021"
    )
    assert cm.session_date_from_text(head) == date(2023, 11, 28)
    assert cm.session_type_from_text(head) == "ordinară"
