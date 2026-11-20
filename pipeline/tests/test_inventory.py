from datetime import date

from mdu.fixtures import fixture_bytes
from mdu.inventory import Row, Survey, TextSample, summary_markdown, text_layer


def test_text_layer_flags_scanned_pages() -> None:
    pages, low = text_layer(fixture_bytes("brasov", "ctatu/decisions-2026-07-29-scanned"))
    assert pages > 0
    assert low == pages
    pages, low = text_layer(fixture_bytes("brasov", "council_debates/puz-02-draft-decision"))
    assert low == 0


def test_summary_has_aggregates_but_no_urls_or_labels() -> None:
    s = Survey(city="testcity")
    s.rows = [
        Row("debates", "document", "https://x.test/Folder Ion Popescu/a.pdf", 2024, False, 2048,
            "listing", label="Memoriu Ion Popescu"),
        Row("debates", "document", "https://x.test/b.pdf", 2025, size_bytes=None),
        Row("minutes", "document", "https://x.test/PV-1.pdf", 2013, True, 4096, "head"),
    ]  # fmt: skip
    s.samples = [TextSample("debates", "https://x.test/a.pdf", 10, 3, 50_000)]
    s.note("debates", "2 debates")
    md = summary_markdown(s, date(2026, 11, 20))
    assert "x.test" not in md
    assert "Popescu" not in md
    assert "| debates | 2 | 0 |" in md
    assert "1/2" in md  # size known for one of two documents
    assert "2013–2013 (partly estimated)" in md
    assert "| debates | 1 | 10 | 3 | 30% |" in md
