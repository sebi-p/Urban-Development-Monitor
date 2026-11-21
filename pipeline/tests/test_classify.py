"""M3.1 acceptance: at least 95% of the classifier test documents get the right type, by rules
alone (CI never calls an LLM). Plus the stage: caching, budget, deferral and versioning."""

import hashlib
import json
import os
import shutil
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, get_args

import psycopg
import pytest

from mdu.core import classify as classifier
from mdu.core.classify import Classification, ClassifyInput, classify_rules, classify_without_llm
from mdu.core.documents import store_raw_document
from mdu.core.enums import DocumentRole
from mdu.core.extract import extract_pdf
from mdu.core.llm import SCHEMA, ClaudeClassifier, LlmError, LlmResult, prompt_text
from mdu.fixtures import FixtureSet, fixture_bytes
from mdu.stages import classify

REQUIRED_ACCURACY = 0.95


def inp(label: str = "", text: str = "", pages: int = 3, cpp: float = 2000) -> ClassifyInput:
    return ClassifyInput(label, text, pages, cpp)


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("07. Registru opinii", "registru_opinii"),
        ("02. Proiect de hotarare", "proiect_hcl"),
        ("PHCL", "proiect_hcl"),
        ("03. Referat aprobare", "referat_aprobare"),
        ("4. Raport de specialitat", "raport_specialitate"),
        ("07. Raport intocmit in baza legii 52_2003", "raport_consultare"),
        ("01. Anunt elaborare proiect de act normativ", "anunt"),
        ("M E M O R I U PUZ final", "memoriu"),
        ("Planșă reglementări urbanistice.pdf", "plansa_reglementari"),
        ("Reglemetari urbanistice", "plansa_reglementari"),  # the city's own misspelling
        ("Incadare in zona PUD", "plansa"),
        ("PUZ CARPATEX MOBILARE ILUSTRATIVA", "plansa"),
        ("Certificat de urbanism", "certificat_urbanism"),
        ("Studiu geotehnic", "studiu"),
        ("Aviz Mediu", "aviz"),
        ("20261020 - ORDINEA DE ZI CTATU 20.10.2026", "ordine_zi_comisie"),
        ("20260527-HOTARARI CTATU 27.05.2026", "hotarari_comisie"),
    ],
)
def test_label_rules(label: str, expected: DocumentRole) -> None:
    found = classify_rules(inp(label))
    assert found is not None
    assert (found.doc_type, found.method) == (expected, "label")


def test_an_approved_design_brief_is_not_an_aviz() -> None:
    assert classify_rules(inp("TEMA AVIZATA BENEFICIAR", "TEMA PROGRAM PENTRU PUD")) is None


def test_text_and_shape_rules_when_the_label_says_nothing() -> None:
    found = classify_rules(inp("3Da", "REFERAT DE APROBARE A PROIECTULUI DE HOTĂRÂRE"))
    assert found is not None
    assert found.doc_type == "referat_aprobare"
    drawing = classify_rules(inp("ZONA", "GSPublisherVersion 0.0.100 proiectat desenat", pages=1))
    assert drawing == Classification("plansa", "shape", "medium", "drawing stamp")
    numbers = classify_rules(inp("A1", " ".join(["4.71", "13.70", "20.15", "PUZ"] * 20), pages=1))
    assert numbers is not None
    assert numbers.rule == "mostly dimensions"
    assert classify_without_llm(inp("Plan Actiune PUZ", "PLAN DE ACȚIUNE")).doc_type == "other"


def require_tesseract() -> None:
    if shutil.which("tesseract"):
        return
    if os.environ.get("MDU_REQUIRE_FIXTURES") == "1":
        pytest.fail("tesseract is not installed (ADR 0006)")
    pytest.skip("tesseract is not installed")


def test_rules_classify_the_test_documents() -> None:
    require_tesseract()
    fs = FixtureSet("brasov")
    fixtures = fs.load()
    golden: dict[str, str] = json.loads((fs.dir / "classify_golden.json").read_text())["types"]
    assert len(golden) >= 70
    assert set(golden.values()) <= set(get_args(DocumentRole))
    misses = []
    for fixture_id, expected in sorted(golden.items()):
        data = fixture_bytes("brasov", fixture_id)
        label = fs.private_meta(fixtures[fixture_id]).get("label")
        if label is None and os.environ.get("MDU_REQUIRE_FIXTURES") == "1":
            pytest.fail(f"{fixture_id}: private sidecar with the listing label is missing")
        text = extract_pdf(data, max_pages=classifier.FIRST_PAGES)
        first = "\n".join(p.text for p in text.pages)
        found = classify_without_llm(
            ClassifyInput(label or "", first, text.total_pages or 1, len(first) / len(text.pages))
        )
        if found.doc_type != expected:
            misses.append((fixture_id, expected, found.doc_type, found.method))
    accuracy = 1 - len(misses) / len(golden)
    assert accuracy >= REQUIRED_ACCURACY, misses


# LLM client (no network: a fake Anthropic client)


class FakeMessages:
    def __init__(self, text: str, stop: str = "end_turn") -> None:
        self.text, self.stop, self.calls = text, stop, 0

    def create(self, **kwargs: Any) -> Any:
        self.calls += 1
        assert kwargs["output_config"]["format"]["schema"] == SCHEMA
        assert "Listing label" in kwargs["messages"][0]["content"]
        return SimpleNamespace(
            stop_reason=self.stop,
            content=[SimpleNamespace(type="text", text=self.text)],
            usage=SimpleNamespace(input_tokens=1000, output_tokens=20),
        )


def test_claude_classifier_parses_the_answer_and_prices_it() -> None:
    messages = FakeMessages(json.dumps({"doc_type": "studiu", "confidence": "medium"}))
    llm = ClaudeClassifier(client=SimpleNamespace(messages=messages))  # type: ignore[arg-type]
    result = llm(inp("Anexa 3", "STUDIU DE INSORIRE"))
    assert result.classification == Classification(
        "studiu", "llm", "medium", llm.model + " classify-v1"
    )
    assert result.cost_usd == pytest.approx((1000 * 0.10 + 20 * 0.50) / 1_000_000)
    refusing = ClaudeClassifier(client=SimpleNamespace(messages=FakeMessages("", stop="refusal")))  # type: ignore[arg-type]
    with pytest.raises(LlmError):
        refusing(inp("x"))


def test_prompt_names_every_document_type() -> None:
    prompt = prompt_text()
    assert all(f"- {t}:" in prompt for t in get_args(DocumentRole))
    assert SCHEMA["properties"]["doc_type"]["enum"] == list(get_args(DocumentRole))


# Stage


class Store:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put(self, key: str, data: bytes, content_type: str | None = None) -> None:
        self.objects[key] = data

    def get(self, key: str) -> bytes:
        return self.objects[key]


class FakeLlm:
    model = "fake-model"
    prompt_version = "classify-v1"

    def __init__(self, answers: list[Any]) -> None:
        self.answers, self.calls = answers, 0

    def __call__(self, inp: ClassifyInput) -> LlmResult:
        answer = self.answers[min(self.calls, len(self.answers) - 1)]
        self.calls += 1
        if isinstance(answer, Exception):
            raise answer
        doc_type, confidence = answer
        return LlmResult(
            Classification(doc_type, "llm", confidence, self.model),
            self.model, self.prompt_version, 900, 10, 0.5, {},
        )  # fmt: skip


def add_doc(conn: psycopg.Connection[Any], store: Store, name: str, label: str, text: str) -> str:
    content = f"%PDF-1.7 {name}".encode()
    sha = hashlib.sha256(content).hexdigest()
    key = f"text/testcity/{sha}.v1.json"
    pages = [{"n": 1, "text": text, "method": "text", "note": None}]
    store.put(key, json.dumps({"version": 1, "pages": pages}).encode())
    with conn.transaction(), conn.cursor() as cur:
        doc_id, _ = store_raw_document(
            cur, jurisdiction_id=1, city="testcity", url=f"https://city.test/{name}.pdf",
            content=content, content_type="application/pdf", fetched_at=datetime.now(UTC),
            upload=store.put,
        )  # fmt: skip
        cur.execute("update raw_document set text_r2_key = %s where id = %s", (key, doc_id))
        cur.execute(
            """insert into source (jurisdiction_id, adapter, base_url)
               values (1, 'testcity.docs', 'https://city.test') on conflict do nothing"""
        )
        cur.execute(
            """insert into "fetch" (jurisdiction_id, source_id, url, status, hints, raw_document_id)
               select 1, id, %s, 'fetched', %s, %s from source where adapter = 'testcity.docs'""",
            (f"https://city.test/{name}.pdf", json.dumps({"label": label}), doc_id),
        )
    return str(doc_id)


def doc_types(conn: psycopg.Connection[Any]) -> dict[str, str | None]:
    rows = conn.execute("select url, doc_type from raw_document").fetchall()
    return {u.rsplit("/", 1)[1].removesuffix(".pdf"): t for u, t in rows}


def test_classify_stage_rules_llm_cache_and_rerun(
    pg: psycopg.Connection[Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    store = Store()
    add_doc(pg, store, "memoriu", "05. Memoriu", "MEMORIU TEHNIC")
    add_doc(pg, store, "brief-a", "Tema", "TEMA PROGRAM PENTRU PUD")
    add_doc(pg, store, "brief-b", "Tema", "TEMA PROGRAM PENTRU PUD")  # same input as brief-a
    add_doc(pg, store, "guess", "Anexa", "ceva neclar")
    llm = FakeLlm([("studiu", "medium"), ("aviz", "low")])

    first = classify(pg, store, city="testcity", llm=llm)
    assert first.counts["by label"] == 1
    assert first.counts["llm_calls"] == 2
    assert first.counts["llm_cached"] == 1
    assert doc_types(pg) == {
        "memoriu": "memoriu",
        "brief-a": "studiu",
        "brief-b": "studiu",
        "guess": "other",
    }  # fmt: skip - a low-confidence guess stays "other"

    again = classify(pg, store, city="testcity", llm=llm)
    assert sum(again.counts.values()) == 0
    assert llm.calls == 2

    monkeypatch.setattr(classifier, "CLASSIFIER_VERSION", "rules-2")
    third = classify(pg, store, city="testcity", llm=llm)
    assert third.counts["by label"] == 1
    assert third.counts["llm_cached"] == 3
    assert llm.calls == 2


def test_llm_errors_and_the_budget_defer_documents(pg: psycopg.Connection[Any]) -> None:
    store = Store()
    add_doc(pg, store, "a", "Anexa 1", "text unu")
    add_doc(pg, store, "b", "Anexa 2", "text doi")
    add_doc(pg, store, "c", "Anexa 3", "text trei")
    broken = FakeLlm([LlmError("HTTP 529")])
    result = classify(pg, store, city="testcity", llm=broken)
    assert result.counts["deferred: LLM error"] == 3
    assert set(doc_types(pg).values()) == {None}

    # Each answer costs $0.50. The budget is checked before each call, so a $0.50 budget allows
    # one call and the rest wait (overshoot is at most one call).
    working = FakeLlm([("studiu", "high")])
    result = classify(pg, store, city="testcity", llm=working, monthly_usd=0.5)
    assert result.counts["llm_calls"] == 1
    assert result.counts["deferred: LLM budget"] == 2
    assert sorted(t for t in doc_types(pg).values() if t) == ["studiu"]

    # Without an LLM, unmatched documents are "other" (rules-only mode).
    result = classify(pg, store, city="testcity", llm=None)
    assert result.counts["other"] == 2
