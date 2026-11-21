"""M2.3 acceptance: scanned fixtures produce readable Romanian text with diacritics."""

import json
import os
import re
import shutil
from datetime import UTC, datetime
from typing import Any

import psycopg
import pymupdf
import pytest

from mdu.core import extract as extractor
from mdu.core.documents import store_raw_document
from mdu.core.extract import ExtractionError, clean, drop_repeated_lines, extract_pdf
from mdu.fixtures import fixture_bytes
from mdu.stages import extract


def require_tesseract() -> None:
    """OCR tests skip locally without Tesseract, but fail in CI (MDU_REQUIRE_FIXTURES=1)."""
    if shutil.which("tesseract"):
        return
    if os.environ.get("MDU_REQUIRE_FIXTURES") == "1":
        pytest.fail("tesseract is not installed (ADR 0006)")
    pytest.skip("tesseract is not installed; brew install tesseract tesseract-lang")


def words(text: str) -> list[str]:
    return re.findall(r"[^\W\d_]{2,}", text)


def test_clean_fixes_cedillas_hyphenation_and_spacing() -> None:
    assert clean("Braşov  şi\xa0Ţara") == "Brașov și Țara"
    assert clean("documen-\ntație\r\n\n\n\nurbanism") == "documentație\n\nurbanism"
    assert "ş" not in clean("ş" * 3)


def test_repeated_headers_and_page_numbers_are_dropped() -> None:
    topics = ["avize", "regulament", "memoriu", "planșe", "consultare"]
    bodies = [f"despre {t}\nalt rând despre {t}\nîncheiere {t}" for t in topics]
    pages = [f"PRIMĂRIA BRAȘOV\n{b}\nPagina {i} din 5" for i, b in enumerate(bodies, start=1)]
    assert drop_repeated_lines(pages) == bodies
    assert drop_repeated_lines(pages[:2]) == pages[:2]  # too short to tell


def test_unreadable_files_raise() -> None:
    with pytest.raises(ExtractionError):
        extract_pdf(b"<html>not a pdf</html>")


def test_text_layer_pdf_needs_no_ocr() -> None:
    text = extract_pdf(fixture_bytes("brasov", "council_debates/puz-memoriu"))
    assert not text.ocr_used
    assert len(text.pages) > 10
    assert [p.n for p in text.pages] == list(range(1, len(text.pages) + 1))
    assert "MEMORIU TEHNIC" in text.pages[0].text
    assert {p.method for p in text.pages} <= {"text", "none"}


def test_scanned_committee_decisions_become_romanian_text() -> None:
    require_tesseract()
    text = extract_pdf(fixture_bytes("brasov", "ctatu/decisions-2026-07-29-scanned"))
    assert text.ocr_used
    assert all(p.method == "ocr" for p in text.pages)
    body = text.text
    flat = " ".join(body.split())
    # Institution headings (no personal data), with comma-below diacritics.
    assert "COMISIA TEHNICĂ DE AMENAJARE A TERITORIULUI ȘI URBANISM" in flat
    assert "PRIMĂRIA MUNICIPIULUI BRAȘOV" in flat
    assert not set("şţŞŢ") & set(body)
    assert set("ăâîșț") <= set(body.lower())
    # Readable: mostly real words, not OCR noise.
    tokens = words(body)
    assert len(tokens) > 500
    common = {"de", "și", "în", "la", "nr", "pentru", "cu", "din", "aviz", "urbanism", "str"}
    assert sum(t.lower() in common for t in tokens) > 0.08 * len(tokens)


def test_ocr_can_be_turned_off() -> None:
    text = extract_pdf(fixture_bytes("brasov", "ctatu/decisions-2026-07-29-scanned"), ocr=False)
    assert not text.ocr_used
    assert text.skipped_pages == {"scan; OCR off": len(text.pages)}


# Stage


class Store:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put(self, key: str, data: bytes, content_type: str | None = None) -> None:
        self.objects[key] = data

    def get(self, key: str) -> bytes:
        return self.objects[key]


def make_pdf(*pages: str) -> bytes:
    doc = pymupdf.open()
    for body in pages:
        page = doc.new_page()
        page.insert_text((72, 72), body)
    data: bytes = doc.tobytes()
    return data


def add_document(conn: psycopg.Connection[Any], store: Store, content: bytes, url: str) -> None:
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("select id from jurisdiction where slug = 'testcity'")
        row = cur.fetchone()
        assert row
        store_raw_document(
            cur,
            jurisdiction_id=row[0],
            city="testcity",
            url=url,
            content=content,
            content_type="application/pdf",
            fetched_at=datetime.now(UTC),
            upload=store.put,
        )


def test_extract_stage_is_a_no_op_on_rerun(
    pg: psycopg.Connection[Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    store = Store()
    add_document(
        pg, store, make_pdf("Aviz de urbanism", "Pagina a doua"), "https://city.test/a.pdf"
    )
    add_document(pg, store, b"%PDF-1.7 broken", "https://city.test/broken.pdf")

    first = extract(pg, store, city="testcity")
    assert first.counts["extracted"] == 1
    assert first.counts["unreadable"] == 1
    assert first.counts["pages"] == 2
    row = pg.execute(
        "select text_r2_key, text_head, page_count, ocr_used from raw_document "
        "where url like '%a.pdf'"
    ).fetchone()
    assert row
    key, head, pages, ocr_used = row
    assert key.startswith("text/testcity/")
    assert key.endswith(".v1.json")
    assert "Aviz de urbanism" in head
    assert (pages, ocr_used) == (2, False)
    saved = json.loads(store.objects[key])
    assert [p["n"] for p in saved["pages"]] == [1, 2]
    broken = pg.execute("select text_r2_key from raw_document where url like '%broken.pdf'")
    broken_key = broken.fetchone()
    assert broken_key
    assert "error" in json.loads(store.objects[broken_key[0]])

    second = extract(pg, store, city="testcity")
    assert sum(second.counts.values()) == 0

    # A new extractor version processes everything again.
    monkeypatch.setattr(extractor, "EXTRACTOR_VERSION", 2)
    third = extract(pg, store, city="testcity")
    assert third.counts["extracted"] == 1
    assert third.counts["unreadable"] == 1
    runs = pg.execute("select count(*) from pipeline_run where stage = 'extract'").fetchone()
    assert runs == (3,)
