"""M3.3 acceptance: golden-set projects merge correctly and ambiguous ones land in review."""

import hashlib
import json
from datetime import UTC, datetime
from typing import Any

import psycopg

from mdu import linker
from mdu.core.documents import store_raw_document
from mdu.core.llm import JsonAnswer
from mdu.core.streets import StreetIndex, StreetPoint
from mdu.fixtures import FixtureSet
from mdu.linker import AUTO, REVIEW, Profile, decide, score


def golden() -> tuple[list[Profile], dict[str, list[Any]]]:
    data = json.loads((FixtureSet("brasov").dir / "linker_golden.json").read_text("utf-8"))
    profiles = [
        Profile(
            subject=p["subject"],
            source=p["source"],
            kind=p["kind"],
            title=p["title"],
            street=p["street"],
            number=p["number"],
            initiator=p["initiator"],
            # Identifiers are hashed in the golden file; equal values still compare equal.
            identifiers=frozenset(("h", h) for h in p["identifiers"]),
            point=tuple(p["point"]) if p["point"] else None,  # type: ignore[arg-type]
            project_id=p["subject"] if p["project"] else None,
            stage=p["stage"],
            first_seen=datetime.fromisoformat(p["first_seen"]) if p["first_seen"] else None,
        )
        for p in data["profiles"]
    ]
    return profiles, data["expected"]


def test_golden_set_links_merge_and_review_correctly() -> None:
    profiles, expected = golden()
    got = {
        d.subject.subject: [d.action, d.target.subject if d.target else None]
        for d in decide(profiles)
    }
    for subject, (action, target) in expected.items():
        assert got.get(subject) == [action, target], subject
    # Nothing else is linked or merged automatically.
    automatic = {s for s, (a, _) in got.items() if a in ("attach", "merge")}
    assert automatic == {s for s, (a, _) in expected.items() if a in ("attach", "merge")}


def p(subject: str, **kw: Any) -> Profile:
    base: dict[str, Any] = {"source": "x", "kind": "puz", "title": "PUZ ansamblu locuinte"}
    return Profile(subject=subject, **{**base, **kw})


def test_an_identifier_alone_only_goes_to_review() -> None:
    a = p("a", identifiers=frozenset({("cu", "12/2024")}))
    b = p("b", identifiers=frozenset({("cu", "12/2024")}), title="Alt titlu complet diferit")
    s, signals = score(a, b)
    assert REVIEW <= s < AUTO
    assert signals["identifier"] == "cu 12/2024"


def test_identifier_street_number_and_initiator_link() -> None:
    a = p(
        "a",
        identifiers=frozenset({("cf", "1")}),
        street="lunga",
        number="5",
        initiator="SC ALFA SRL",
    )
    b = p(
        "b",
        identifiers=frozenset({("cf", "1")}),
        street="lunga",
        number="5",
        initiator="ALFA S.R.L.",
    )
    assert score(a, b)[0] >= AUTO


def test_different_kinds_streets_numbers_or_far_apart_do_not_link() -> None:
    a = p("a", street="lunga", number="5", initiator="SC ALFA SRL")
    assert score(a, p("b", kind="pud", street="lunga", number="5"))[0] == 0
    assert score(a, p("b", street="scurta", number="5", initiator="SC ALFA SRL"))[0] < REVIEW
    # Same street and developer but another plot: ambiguous, so a reviewer decides.
    assert score(a, p("b", street="lunga", number="7", initiator="SC ALFA SRL"))[0] < AUTO
    far = score(
        p("a", street="lunga", number="5", point=(25.60, 45.65), initiator="SC ALFA SRL"),
        p("b", street="lunga", number="5", point=(25.60, 45.70), initiator="SC ALFA SRL"),
    )
    assert far[0] < REVIEW
    assert far[1]["distance_km"] > 1


def test_the_later_stage_absorbs_the_earlier_one() -> None:
    notice = p(
        "project:n", project_id="n", stage=1, street="lunga", number="5", initiator="SC ALFA SRL"
    )
    debate = p(
        "project:d", project_id="d", stage=5, street="lunga", number="5", initiator="SC ALFA SRL"
    )
    [d] = decide([debate, notice])
    assert (d.action, d.subject.subject, d.target and d.target.subject) == (
        "merge",
        "project:n",
        "project:d",
    )


# Applying decisions in the database


class Store:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put(self, key: str, data: bytes, content_type: str | None = None) -> None:
        self.objects[key] = data

    def get(self, key: str) -> bytes:
        return self.objects[key]


def item(value: Any, doc: int, page: int, quote: str) -> dict[str, Any]:
    return {"value": value, "doc": doc, "page": page, "quote": quote}


class FakeExtractor:
    model, prompt_version = "fake", "fields-v2"

    def __call__(self, pages_text: str) -> JsonAnswer:
        if "Strada Lungă" in pages_text:
            data = {
                "title": item(
                    "Ansamblu de locuințe Strada Lungă", 0, 1, "Ansamblu de locuințe Strada Lungă"
                ),
                "address": item("Strada Lungă nr. 5", 0, 1, "Strada Lungă nr. 5"),
                "initiator": item("SC ALFA SRL", 0, 1, "beneficiar SC ALFA SRL"),
            }
        elif "Florilor" in pages_text:
            data = {
                "title": item(
                    "Hală depozitare str. Florilor", 0, 1, "Hală depozitare str. Florilor"
                )
            }
        else:  # a single private house
            data = {
                "title": item(
                    "Construire locuință unifamilială", 0, 1, "Construire locuință unifamilială"
                )
            }
        return JsonAnswer(data, self.model, 1000, 100, 0.01)


STREETS = StreetIndex(
    {
        "lunga": StreetPoint("Strada Lungă", 25.60, 45.65),
        "florilor": StreetPoint("Strada Florilor", 25.62, 45.66),
    }
)


def add_group_doc(cur: psycopg.Cursor[Any], store: Store, group: str, text: str) -> None:
    content = f"%PDF-1.7 {group}".encode()
    sha = hashlib.sha256(content).hexdigest()
    key = f"text/testcity/{sha}.v1.json"
    store.put(key, json.dumps({"pages": [{"n": 1, "text": text}]}).encode())
    doc_id, _ = store_raw_document(
        cur, jurisdiction_id=1, city="testcity", url=f"https://city.test/hub/{group}.pdf",
        content=content, content_type="application/pdf", fetched_at=datetime.now(UTC),
        upload=store.put, doc_type="memoriu",
    )  # fmt: skip
    cur.execute("update raw_document set text_r2_key = %s where id = %s", (key, doc_id))
    cur.execute(
        """insert into source (jurisdiction_id, adapter, base_url)
           values (1, 'testcity.hub', 'https://city.test/hub') on conflict do nothing"""
    )
    cur.execute(
        """insert into "fetch" (jurisdiction_id, source_id, url, status, raw_document_id,
               fetched_at, hints)
           select 1, id, %s, 'fetched', %s, now(), %s from source where adapter = 'testcity.hub'""",
        (f"https://city.test/hub/{group}.pdf", doc_id,
         json.dumps({"group": group, "kind": "puz", "label": "MEMORIU"})),
    )  # fmt: skip


def setup(conn: psycopg.Connection[Any], store: Store) -> None:
    with conn.transaction(), conn.cursor() as cur:
        projects = (
            ("debate-lunga", "approved", "testcity.debates"),
            ("notice-lunga", "in_preparation", "testcity.notices"),
        )
        for slug, status, source in projects:
            cur.execute(
                """insert into project (jurisdiction_id, slug, kind, status, title, address_text,
                       initiator, review_state, geom)
                   values (1, %s, 'puz', %s, 'PUZ Ansamblu de locuințe Strada Lungă',
                       'Strada Lungă nr. 5', 'SC ALFA SRL', 'auto_published',
                       ST_SetSRID(ST_MakePoint(25.60, 45.65), 4326))
                   returning id""",
                (slug, status),
            )
            row = cur.fetchone()
            assert row
            cur.execute(
                """insert into project_event (jurisdiction_id, project_id, event_date, event_type,
                       title, details, confidence, review_state)
                   values (1, %s, '2026-01-01', 'consultation_opened', 'Publicat', %s, 'high',
                       'auto_published')""",
                (row[0], json.dumps({"source": source, "kind": "listing"})),
            )
        add_group_doc(
            cur,
            store,
            "g-lunga",
            "MEMORIU Ansamblu de locuințe Strada Lungă\nStrada Lungă nr. 5\nbeneficiar SC ALFA SRL",
        )
        add_group_doc(cur, store, "g-florilor", "MEMORIU Hală depozitare str. Florilor")
        add_group_doc(cur, store, "g-casa", "MEMORIU Construire locuință unifamilială")


def counts(conn: psycopg.Connection[Any]) -> dict[str, Any]:
    return {
        "visible": [
            r[0]
            for r in conn.execute(
                "select slug from project where merged_into_id is null order by slug"
            )
        ],
        "merged": conn.execute(
            "select count(*) from project where merged_into_id is not null"
        ).fetchone(),
        "documents": conn.execute("select count(*) from project_document").fetchone(),
    }


def test_linker_attaches_creates_merges_and_reruns_as_no_op(pg: psycopg.Connection[Any]) -> None:
    store = Store()
    setup(pg, store)
    first = linker.run(pg, store, city="testcity", streets=STREETS, extractor=FakeExtractor())
    assert first.counts["projects merged"] == 1  # the notice joins the debate
    assert first.counts["groups attached"] == 1  # the Lungă folder joins the debate
    assert first.counts["groups as projects"] == 1  # the Florilor folder is a new plan
    assert first.counts["groups skipped: private or untitled"] == 1  # a single private house
    state = counts(pg)
    assert state["merged"] == (1,)
    assert "notice-lunga" not in state["visible"]
    assert "debate-lunga" in state["visible"]
    assert any(s.startswith("hala-depozitare") for s in state["visible"])
    assert not any("locuinta" in s for s in state["visible"])
    new = pg.execute(
        "select status::text, address_text from project where slug like 'hala-depozitare%'"
    ).fetchone()
    assert new == ("in_preparation", "Strada Florilor")

    second = linker.run(pg, store, city="testcity", streets=STREETS, extractor=FakeExtractor())
    assert second.counts["projects merged"] == 0
    assert second.counts["groups already linked"] == 2
    assert counts(pg) == state


def test_a_rejected_merge_is_not_made_again(pg: psycopg.Connection[Any]) -> None:
    store = Store()
    setup(pg, store)
    linker.run(pg, store, city="testcity", streets=STREETS, extractor=FakeExtractor())
    pg.execute("update link_candidate set state = 'rejected' where subject like 'project:%'")
    pg.execute("update project set merged_into_id = null")  # a reviewer split them
    linker.run(pg, store, city="testcity", streets=STREETS, extractor=FakeExtractor())
    assert counts(pg)["merged"] == (0,)
