"""M3.2 acceptance: 90% field accuracy on the golden set, replaying recorded model answers (CI
never calls the API). Plus the checks that keep invented values and people's names out."""

import hashlib
import json
from datetime import UTC, date, datetime
from typing import Any

import psycopg

from mdu import evals
from mdu.core.documents import store_raw_document
from mdu.core.fields import (
    SourceDocument,
    check,
    numbers_in,
    organisations_in,
    select_pages,
)
from mdu.core.identifiers import find_identifiers
from mdu.core.llm import FIELDS_MODEL, JsonAnswer
from mdu.fixtures import FixtureSet, fixture_bytes
from mdu.project_fields import extract_fields


def test_numbers_in_romanian_formats() -> None:
    assert {1855.0, 0.8, 30.9, 14487.0} <= numbers_in(
        "1.855,00 mp; CUT 0,80; Hmax=30.90m; 14 487 mp"
    )
    assert {12500.0, 12.5} <= numbers_in("12.500")


def test_only_organisations_are_named() -> None:
    assert organisations_in("Cozma Calin reprezentant DECENT REAL ESTATE") == ["DECENT REAL ESTATE"]
    assert organisations_in("Covaliu Visarion Alin pentru Dobrotescu Maria Monica si altii") == []
    assert organisations_in("SC West Garden Brașov și SC West Garden Bartolomeu") == [
        "SC West Garden Brașov",
        "SC West Garden Bartolomeu",
    ]
    assert organisations_in("arh. Gabriel Popescu") == []


def test_identifiers_of_the_project() -> None:
    found = find_identifiers(
        [
            "Certificatul de urbanism nr. 2801/26.10.2018, teren înscris în CF nr. 141560",
            "nr. cad. 176317; PUZ aprobat cu HCL nr. 198/2015; C.U. nr. 2801/26.10.2018",
        ]
    )
    assert {(f.scheme, f.value, f.page) for f in found} == {
        ("cu", "2801/2018-10-26", 1),
        ("cf", "141560", 1),
        ("nr_cadastral", "176317", 2),
    }
    assert next(f for f in found if f.scheme == "cu").issued_on == date(2018, 10, 26)


DOCS = [
    SourceDocument(
        "d-memoriu",
        "memoriu",
        ["MEMORIU TEHNIC", "POT max = 35% CUT max = 1,2 regim de înălțime P+4E"],
    ),
    SourceDocument(
        "d-raport", "raport_specialitate", ["inițiator SC ALFA SRL prin Ion Pop, beneficiar"]
    ),
    SourceDocument("d-plansa", "plansa", ["POT POT POT"]),  # not read: drawings
]


def item(value: Any, doc: int, page: int, quote: str) -> dict[str, Any]:
    return {"value": value, "doc": doc, "page": page, "quote": quote}


def test_values_must_be_quoted_from_the_cited_page() -> None:
    sel = select_pages(DOCS)
    assert [d.doc_type for d in sel.documents] == ["raport_specialitate", "memoriu"]
    answer = {
        "pot_percent": item(35, 1, 2, "POT max = 35%"),
        "cut": item(1.5, 1, 2, "CUT max = 1,2"),  # number not in the quote
        "height_regime": item("P+6E", 1, 2, "regim de înălțime P+6E"),  # quote not on the page
        "max_height_m": item(18, 7, 1, "H max 18 m"),  # no such document
        "initiator": item("SC ALFA SRL prin Ion Pop", 0, 1, "inițiator SC ALFA SRL prin Ion Pop"),
        "designer": item("Ion Pop", 0, 1, "Ion Pop"),
    }
    checked = check(answer, sel)
    assert {v.field: v.value for v in checked.kept} == {
        "pot_percent": 35,
        "initiator": "SC ALFA SRL",
    }
    assert checked.dropped == {
        "cut": "number not in the quote",
        "height_regime": "quote not on the cited page",
        "max_height_m": "unknown document",
        "designer": "not an organisation",
    }
    person = check({"initiator": item("Ion Pop", 0, 1, "Ion Pop")}, sel)
    assert person.kept[0].value == "persoană fizică"


def test_golden_set_accuracy_from_recorded_answers() -> None:
    fs = FixtureSet("brasov")
    for project in evals.golden(fs).values():  # skips locally when fixtures aren't pulled
        for d in project["documents"]:
            fixture_bytes("brasov", d["fixture"])
    for slug in evals.golden(fs):
        fixture_bytes("brasov", evals.recording_id(slug, FIELDS_MODEL))
    result = evals.run(fs, evals.replay(fs, FIELDS_MODEL), model=FIELDS_MODEL)
    assert result.scored >= 50
    wrong = {p.slug: p.wrong for p in result.projects if p.wrong}
    assert result.accuracy >= evals.REQUIRED_ACCURACY, wrong


# Stage


class Store:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put(self, key: str, data: bytes, content_type: str | None = None) -> None:
        self.objects[key] = data

    def get(self, key: str) -> bytes:
        return self.objects[key]


class FakeExtractor:
    model = "fake-model"
    prompt_version = "fields-v1"

    def __init__(self, answer: dict[str, Any]) -> None:
        self.answer, self.calls = answer, 0

    def __call__(self, pages_text: str) -> JsonAnswer:
        self.calls += 1
        assert '<page doc="0" type="raport_specialitate" n="1">' in pages_text
        return JsonAnswer(self.answer, self.model, 5000, 300, 0.02)


def project_with_documents(conn: psycopg.Connection[Any], store: Store) -> None:
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """insert into project (jurisdiction_id, slug, kind, status, title, review_state)
               values (1, 'puz-test', 'puz', 'approved', 'PUZ test', 'auto_published')
               returning id"""
        )
        row = cur.fetchone()
        assert row
        docs = []
        for name, doc_type, pages in (
            ("raport", "raport_specialitate", ["inițiator SC ALFA SRL, C.U. nr. 12/01.02.2024"]),
            ("memoriu", "memoriu", ["MEMORIU", "POT max = 35% și regim de înălțime P+4E"]),
            ("registru", "registru_opinii", ["Ion Pop: sunt împotrivă"]),
        ):
            content = f"%PDF-1.7 {name}".encode()
            sha = hashlib.sha256(content).hexdigest()
            key = f"text/testcity/{sha}.v1.json"
            body = {"pages": [{"n": i + 1, "text": t} for i, t in enumerate(pages)]}
            store.put(key, json.dumps(body).encode())
            doc_id, _ = store_raw_document(
                cur, jurisdiction_id=1, city="testcity", url=f"https://city.test/{name}.pdf",
                content=content, content_type="application/pdf", fetched_at=datetime.now(UTC),
                upload=store.put, doc_type=doc_type,
            )  # fmt: skip
            cur.execute("update raw_document set text_r2_key = %s where id = %s", (key, doc_id))
            cur.execute(
                """insert into source (jurisdiction_id, adapter, base_url)
                   values (1, 'testcity.docs', 'https://city.test') on conflict do nothing"""
            )
            cur.execute(
                """insert into "fetch" (jurisdiction_id, source_id, url, status, raw_document_id,
                       fetched_at)
                   select 1, id, %s, 'fetched', %s, now() from source
                   where adapter = 'testcity.docs'""",
                (f"https://city.test/{name}.pdf", doc_id),
            )
            docs.append({"label": name, "url": f"https://city.test/{name}.pdf"})
        cur.execute(
            """insert into project_event (jurisdiction_id, project_id, event_date, event_type,
                   title, details, confidence, review_state)
               values (1, %s, '2026-01-01', 'consultation_opened', 'Publicat', %s, 'high',
                   'auto_published')""",
            (row[0], json.dumps({"source": "testcity.docs", "documents": docs})),
        )


def test_extract_fields_links_extracts_writes_and_reruns_as_no_op(
    pg: psycopg.Connection[Any],
) -> None:
    store = Store()
    project_with_documents(pg, store)
    answer = {
        "initiator": item("SC ALFA SRL", 0, 1, "inițiator SC ALFA SRL"),
        "pot_percent": item(35, 1, 2, "POT max = 35%"),
        "height_regime": item("P+4E", 1, 2, "regim de înălțime P+4E"),
        "dwellings": item(120, 1, 2, "120 apartamente"),  # not on the page: dropped
    }
    extractor = FakeExtractor(answer)
    first = extract_fields(pg, store, city="testcity", extractor=extractor)
    assert first.counts["linked"] == 2
    assert first.counts["llm_calls"] == 1
    assert first.counts["identifiers new"] == 1
    row = pg.execute("select initiator, indicators from project where slug = 'puz-test'").fetchone()
    assert row
    initiator, indicators = row
    assert initiator == "SC ALFA SRL"
    assert set(indicators) == {"pot_percent", "height_regime"}
    assert indicators["pot_percent"]["value"] == 35
    assert indicators["pot_percent"]["page"] == 2
    assert indicators["pot_percent"]["source_url"] == "https://city.test/memoriu.pdf"
    roles = pg.execute("select role::text from project_document order by 1").fetchall()
    assert roles == [("memoriu",), ("raport_specialitate",)]

    again = extract_fields(pg, store, city="testcity", extractor=extractor)
    assert extractor.calls == 1
    assert again.counts["cached"] == 1
    assert again.counts["projects unchanged"] == 1
    assert again.counts["linked"] == 0


def test_without_an_extractor_only_links_and_identifiers(pg: psycopg.Connection[Any]) -> None:
    store = Store()
    project_with_documents(pg, store)
    result = extract_fields(pg, store, city="testcity", extractor=None)
    assert result.counts["fields: LLM off"] == 1
    assert result.counts["identifiers new"] == 1
