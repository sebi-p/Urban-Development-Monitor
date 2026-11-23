"""M4.2: plain-language summaries are neutral, add no numbers, name no one, and cite a document.
The stage writes them with their source and leaves them alone on a re-run."""

import json
from typing import Any

import psycopg
from test_fields import FakeExtractor, Store, item, project_with_documents

from mdu import summaries
from mdu.core import summary
from mdu.core.fields import SourceDocument, select_pages
from mdu.core.llm import JsonAnswer
from mdu.project_fields import extract_fields

DOCS = [
    SourceDocument(
        "d1", "memoriu", ["MEMORIU. Construire locuințe colective P+4E, 120 apartamente"]
    )
]
SELECTION = select_pages(DOCS, read_order=("memoriu",), first_page_of=("memoriu",))
INPUT = summary.prompt_text("title: PUZ Locuințe\ninitiator: SC ALFA SRL", SELECTION)
ALLOWED = "PUZ Locuințe str. Lungă SC ALFA SRL Brașov"
GOOD_RO = (
    "Planul urbanistic zonal (PUZ) propune 120 de apartamente în clădiri P+4E. "
    "Inițiator: SC ALFA SRL."
)
GOOD_EN = (
    "The zonal urban plan (PUZ) proposes 120 apartments in P+4E buildings. Initiator: SC ALFA SRL."
)


def answer(ro: str = GOOD_RO, en: str = GOOD_EN, doc: int = 0, page: int = 1) -> dict[str, Any]:
    return {"summary_ro": ro, "summary_en": en, "doc": doc, "page": page}


def test_a_factual_summary_is_kept() -> None:
    checked = summary.check(answer(), INPUT, SELECTION, ALLOWED)
    assert checked.kept, checked.dropped
    assert (checked.doc_index, checked.page) == (0, 1)


def test_numbers_judgements_and_names_are_refused() -> None:
    cases = {
        "ro: number not in the documents": answer(ro=GOOD_RO.replace("120", "150")),
        "en: evaluative word": answer(en=GOOD_EN.replace("proposes", "proposes an impressive")),
        "ro: may name a person": answer(ro=GOOD_RO + " Beneficiar: Ion Popescu."),
        "unknown page": answer(page=4),
    }
    for reason, a in cases.items():
        assert summary.check(a, INPUT, SELECTION, ALLOWED).dropped == [reason]


def test_place_and_body_names_are_not_taken_for_people() -> None:
    text = (
        "Consiliul Local al Municipiului Brașov a primit planul pentru Strada Ion Pop. Spațiile "
        "verzi ocupă 20%. Inițiator: SC ALFA SRL."
    )
    assert summary.unknown_names(text, ALLOWED) == []
    assert summary.unknown_names("Inițiator: Maria Ionescu.", ALLOWED) == ["Maria Ionescu"]


class FakeWriter:
    model = "fake-model"
    prompt_version = summary.PROMPT_VERSION

    def __init__(self, reply: dict[str, Any]) -> None:
        self.reply, self.calls = reply, 0

    def __call__(self, text: str) -> JsonAnswer:
        self.calls += 1
        assert "<project>" in text
        return JsonAnswer(self.reply, self.model, 4000, 200, 0.01)


def test_summary_stage_writes_with_source_and_reruns_as_no_op(
    pg: psycopg.Connection[Any],
) -> None:
    store = Store()
    project_with_documents(pg, store)
    fields_answer = {"pot_percent": item(35, 1, 2, "POT max = 35%")}
    extract_fields(pg, store, city="testcity", extractor=FakeExtractor(fields_answer))
    reply = answer(
        ro="Planul urbanistic zonal (PUZ) propune un POT max de 35% și regim P+4E. Inițiator: "
        "persoană fizică.",
        en="The zonal urban plan (PUZ) proposes a maximum POT of 35% and P+4E levels. "
        "Initiator: a private individual.",
        doc=1,
        page=2,
    )
    writer = FakeWriter(reply)
    first = summaries.run(pg, store, city="testcity", writer=writer)
    assert first.counts["written"] == 1, first.counts
    row = pg.execute("select summary_ro, summary_en, indicators->'summary' from project").fetchone()
    assert row
    assert row[0].startswith("Planul urbanistic zonal")
    assert row[2]["source_url"] == "https://city.test/memoriu.pdf"
    assert row[2]["page"] == 2
    assert row[2]["prompt_version"] == summary.PROMPT_VERSION
    again = summaries.run(pg, store, city="testcity", writer=writer)
    assert writer.calls == 1
    assert again.counts["unchanged"] == 1
    # The fields stage rewrites the indicators but keeps the summary's source.
    pg.execute("update project set indicators = indicators - 'pot_percent'")
    rewrite = extract_fields(pg, store, city="testcity", extractor=FakeExtractor(fields_answer))
    assert rewrite.counts["projects updated"] == 1
    kept = pg.execute("select indicators from project").fetchone()
    assert kept
    assert kept[0]["summary"] == row[2]
    assert "pot_percent" in kept[0]


def test_a_failed_check_keeps_the_previous_summary(pg: psycopg.Connection[Any]) -> None:
    store = Store()
    project_with_documents(pg, store)
    extract_fields(pg, store, city="testcity", extractor=None)
    pg.execute("update project set summary_ro = 'Vechi', summary_en = 'Old'")
    bad = FakeWriter(answer(ro="Un proiect spectaculos de 999 de etaje.", doc=0))
    result = summaries.run(pg, store, city="testcity", writer=bad)
    assert result.counts["written"] == 0
    assert json.dumps(dict(result.counts)).count("dropped") >= 1
    assert pg.execute("select summary_ro from project").fetchone() == ("Vechi",)
