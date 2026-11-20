"""Brașov parsers against real pages (raw fixtures from private R2, ADR 0004)."""

import io
from datetime import date

from pypdf import PdfReader

from mdu.adapters.brasov import (
    council_agendas,
    council_debates,
    council_minutes,
    notices,
    urbanism_hub,
)
from mdu.adapters.brasov.common import parse_ro_date, parse_size
from mdu.fixtures import fixture_bytes


def raw(fixture_id: str) -> bytes:
    return fixture_bytes("brasov", fixture_id)


def test_ro_dates_and_sizes() -> None:
    assert parse_ro_date("03 Noi 2026") == date(2026, 11, 3)
    assert parse_ro_date("ședința din data de 25-09-2026") == date(2026, 9, 25)
    assert parse_ro_date("12 Sept 2025") == date(2025, 9, 12)
    assert parse_ro_date("din data de 30 august 2013") == date(2013, 8, 30)
    assert parse_ro_date("25 septembrie 2026") == date(2026, 9, 25)
    assert parse_ro_date("fără dată") is None
    assert parse_size("[86.94 KB]") == round(86.94 * 1024)
    assert parse_size("[1,5 MB]") == round(1.5 * 1024**2)
    assert parse_size("no size") is None


def test_debate_listing() -> None:
    debates = council_debates.parse_listing(raw("council_debates/listing"))
    assert len(debates) >= 100
    assert all(d.published and d.title and d.status and d.files for d in debates)
    assert all(f.size_bytes for d in debates for f in d.files)
    assert {"Aprobat prin HCL", "În dezbatere publică"} <= {d.status for d in debates}
    assert min(d.published.year for d in debates if d.published) <= 2021


def test_hub_page_lists_plan_and_committee_files() -> None:
    files = urbanism_hub.parse_page(raw("urbanism_hub/page"))
    kinds = {f.kind for f in files}
    assert {"pud", "puz", "ctatu"} <= kinds
    assert all(f.url.startswith("https://www.brasovcity.ro/file-zone/urbanism/") for f in files)


def test_minutes_listing() -> None:
    minutes = council_minutes.parse_listing(raw("council_minutes/listing"))
    assert minutes[0].number > minutes[-1].number
    assert minutes[0].session_date is not None
    assert council_minutes.minutes_url(7).endswith("/CMBV-PV-7.pdf")
    assert council_minutes.session_date_from_text(
        "Proces verbal al ședinței ordinare din data de 25.09.2026"
    ) == date(2026, 9, 25)
    for fixture_id, expected in (
        ("council_minutes/pv-182", date(2013, 8, 30)),
        ("council_minutes/pv-468", date(2026, 9, 25)),
    ):
        first_page = PdfReader(io.BytesIO(raw(fixture_id))).pages[0].extract_text() or ""
        assert council_minutes.session_date_from_text(first_page) == expected


def test_agenda_page_and_empty_template() -> None:
    agenda = council_agendas.parse_agenda(raw("council_agendas/session-470"))
    assert agenda is not None
    assert agenda.session_date == date(2026, 11, 20)
    assert agenda.items >= 50
    # Old ids return the template only; the sidebar's current agenda must not count.
    assert council_agendas.parse_agenda(raw("council_agendas/session-400")) is None


def test_notices_listing_decodes_article_ids() -> None:
    assert notices.decode_article_id("Mzc4Mjc") == 37827
    assert notices.decode_article_id("not-base64!") is None
    items = notices.parse_listing(raw("notices/listing"))
    assert len(items) >= 10
    assert "urbanism" in {n.category for n in items}
    assert all(n.article_id > 30000 for n in items)
