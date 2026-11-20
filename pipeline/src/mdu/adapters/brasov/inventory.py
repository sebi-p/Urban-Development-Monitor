"""Brașov discover-only inventory (M0.2). Each section mirrors a future adapter's discover()."""

import io
import re
from collections import Counter
from collections.abc import Callable

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from mdu.adapters.brasov import (
    council_agendas,
    council_debates,
    council_minutes,
    notices,
    urbanism_hub,
)
from mdu.adapters.brasov.common import BASE_URL
from mdu.core.http import HttpError, PoliteClient
from mdu.inventory import Row, Survey, sample_text_layers

DRAFTS_LISTING_URL = f"{BASE_URL}/consiliul-local/proiecte-de-hotarare"
_COMMITTEE_DATE = re.compile(r"/(20\d{2})(\d{2})(\d{2})")


def _get(client: PoliteClient, survey: Survey, source: str, url: str) -> bytes | None:
    try:
        resp = client.get(url)
    except HttpError as exc:
        survey.note(source, f"request failed: {type(exc).__name__}")
        return None
    if resp.status != 200:  # noqa: PLR2004
        survey.note(source, f"listing returned HTTP {resp.status}")
        return None
    return resp.content


def _debates(client: PoliteClient, survey: Survey, log: Callable[[str], None]) -> None:
    html = _get(client, survey, "council_debates", council_debates.LISTING_URL)
    if html is None:
        return
    survey.rows.append(Row("council_debates", "page", council_debates.LISTING_URL, status=200))
    debates = council_debates.parse_listing(html)
    rows = []
    for d in debates:
        for f in d.files:
            rows.append(
                Row(
                    "council_debates",
                    "document",
                    f.url,
                    year=d.published.year if d.published else None,
                    size_bytes=f.size_bytes,
                    size_from="listing" if f.size_bytes else None,
                    label=f.label,
                )
            )
    survey.rows += rows
    statuses = ", ".join(f"{s}: {n}" for s, n in Counter(d.status for d in debates).most_common())
    urban = sum(bool(re.search(r"P\.?\s?U\.?\s?[ZD]\b", d.title)) for d in debates)
    survey.note(
        "council_debates", f"{len(debates)} debates on one page ({urban} PUZ/PUD); {statuses}."
    )
    big = [r for r in rows if (r.size_bytes or 0) > 5 * 2**20]
    survey.note(
        "council_debates",
        f"{len(big)} files over 5 MB hold {sum(r.size_bytes or 0 for r in big) / 2**30:.2f} GB "
        "(mostly plan sheets): record them, don't mirror them (PLAN §5).",
    )
    log(f"council_debates: {len(debates)} debates, {len(rows)} files")
    sample_text_layers(client, survey, "council_debates", rows, k=6)


def _hub(client: PoliteClient, survey: Survey, log: Callable[[str], None]) -> None:
    html = _get(client, survey, "urbanism_hub", urbanism_hub.PAGE_URL)
    if html is None:
        return
    survey.rows.append(Row("urbanism_hub", "page", urbanism_hub.PAGE_URL, status=200))
    files = urbanism_hub.parse_page(html)
    plan_rows: list[Row] = []
    ctatu_rows: list[Row] = []
    for f in files:
        m = _COMMITTEE_DATE.search(f.url)
        source = "ctatu" if f.kind == "ctatu" else "urbanism_hub"
        if f.kind == "circulatie":
            continue  # traffic committee: out of scope for v1
        row = Row(
            source,
            "document",
            f.url,
            year=int(m.group(1)) if m else None,
            size_bytes=f.size_bytes,
            size_from="listing" if f.size_bytes else None,
            label=f.label,
        )
        (ctatu_rows if source == "ctatu" else plan_rows).append(row)
    survey.rows += plan_rows + ctatu_rows
    folders = len({f.group for f in files if f.kind in ("pud", "puz")})
    survey.note(
        "urbanism_hub",
        f"{len(plan_rows)} PUD/PUZ files in {folders} project folders (current items only).",
    )
    survey.note(
        "ctatu",
        f"{len(ctatu_rows)} files linked, all from the current year; earlier years' folders "
        "aren't linked anywhere we've found.",
    )
    log(f"urbanism_hub: {len(plan_rows)} plan files; ctatu: {len(ctatu_rows)} files")
    sample_text_layers(client, survey, "urbanism_hub", plan_rows, k=4)
    sample_text_layers(client, survey, "ctatu", ctatu_rows, k=4)


def _drafts(client: PoliteClient, survey: Survey, log: Callable[[str], None]) -> None:
    html = _get(client, survey, "council_drafts", DRAFTS_LISTING_URL)
    if html is None:
        return
    blocked = len(re.findall(rb"extranet\.brasovcity\.ro/Registratura", html))
    survey.rows.append(Row("council_drafts", "page", DRAFTS_LISTING_URL, status=200))
    survey.note(
        "council_drafts",
        f"{blocked} document links point to the robots-disallowed extranet host; not counted "
        "or fetched. Only the titles on the www listing are usable.",
    )
    log(f"council_drafts: {blocked} blocked document links")


def _date_minutes(
    client: PoliteClient, rows: list[Row], known_year: dict[int, int]
) -> list[tuple[int, int]]:
    """Read the session date from an evenly spaced sample of minutes, then interpolate years
    for the rest. Returns the (number, year) anchors used."""
    sample = rows[:: max(1, len(rows) // 8)][:8]
    for row in sample:
        try:
            resp = client.get(row.url)
        except HttpError:
            continue
        try:
            reader = PdfReader(io.BytesIO(resp.content))
            first = (reader.pages[0].extract_text() or "") if reader.pages else ""
        except PdfReadError:
            continue
        d = council_minutes.session_date_from_text(first)
        if d:
            known_year[int(row.label.split()[1])] = d.year
    anchors = sorted(known_year.items())
    for row in rows:
        if row.year is not None:
            continue
        n = int(row.label.split()[1])
        lower = [a for a in anchors if a[0] <= n]
        upper = [a for a in anchors if a[0] >= n]
        if lower and upper:
            (n0, y0), (n1, y1) = lower[-1], upper[0]
            row.year = y0 if n1 == n0 else round(y0 + (y1 - y0) * (n - n0) / (n1 - n0))
            row.year_estimated = True
    return anchors


def _minutes(client: PoliteClient, survey: Survey, log: Callable[[str], None], step: int) -> None:
    html = _get(client, survey, "council_minutes", council_minutes.LISTING_URL)
    if html is None:
        return
    survey.rows.append(Row("council_minutes", "page", council_minutes.LISTING_URL, status=200))
    listed = council_minutes.parse_listing(html)
    if not listed:
        survey.note("council_minutes", "listing had no CMBV-PV links")
        return
    newest = listed[0].number
    known_year = {m.number: m.session_date.year for m in listed if m.session_date}

    rows: list[Row] = []
    for n in range(1, newest + 1, step):
        url = council_minutes.minutes_url(n)
        try:
            resp = client.head(url)
        except HttpError as exc:
            survey.note("council_minutes", f"HEAD failed for one number: {type(exc).__name__}")
            continue
        if resp.status == 200:  # noqa: PLR2004
            rows.append(
                Row(
                    "council_minutes",
                    "document",
                    url,
                    year=known_year.get(n),
                    size_bytes=resp.content_length,
                    size_from="head" if resp.content_length else None,
                    status=200,
                    label=f"PV {n}",
                )
            )
        if n % 50 == 1:
            log(f"council_minutes: probed up to {n}/{newest}, {len(rows)} found")
    missing = len(range(1, newest + 1, step)) - len(rows)

    anchors = _date_minutes(client, rows, known_year)
    survey.rows += rows
    survey.note(
        "council_minutes",
        f"CMBV-PV-1…{newest} probed with HEAD (step {step}): {len(rows)} exist, {missing} "
        f"missing. Years come from {len(anchors)} dated minutes and are interpolated between them.",
    )
    log(f"council_minutes: {len(rows)} of {newest} exist")
    sample_text_layers(client, survey, "council_minutes", rows, k=6)


def _agendas(client: PoliteClient, survey: Survey, log: Callable[[str], None]) -> None:
    latest = council_agendas.LATEST_KNOWN_ID
    ids = list(range(latest + 3, latest - 11, -1)) + list(range(latest - 20, 99, -20))
    found: dict[int, council_agendas.Agenda] = {}
    probed: list[int] = []
    empty_run = 0
    for sid in ids:
        probed.append(sid)
        html = _get(client, survey, "council_agendas", council_agendas.agenda_url(sid))
        agenda = council_agendas.parse_agenda(html) if html else None
        if agenda:
            found[sid] = agenda
            empty_run = 0
        else:
            empty_run += 1
        if sid < latest - 10 and empty_run >= 4:  # noqa: PLR2004
            break
    for sid, agenda in sorted(found.items()):
        survey.rows.append(
            Row(
                "council_agendas",
                "page",
                council_agendas.agenda_url(sid),
                year=agenda.session_date.year if agenda.session_date else None,
                status=200,
                label=f"session {sid}",
            )
        )
    survey.note(
        "council_agendas",
        f"probed {len(probed)} ids from {min(probed)} to {max(probed)}; agendas found for "
        f"{len(found)} ({', '.join(str(i) for i in sorted(found)) or 'none'}). Older ids return "
        "the empty template, so agenda history must come from minutes.",
    )
    log(f"council_agendas: {len(found)} with content")


def _notices(client: PoliteClient, survey: Survey, log: Callable[[str], None]) -> None:
    html = _get(client, survey, "notices", notices.LISTING_URL)
    if html is None:
        return
    survey.rows.append(Row("notices", "page", notices.LISTING_URL, status=200))
    items = notices.parse_listing(html)
    for n in items:
        survey.rows.append(Row("notices", "page", n.url, label=n.category))
    cats = ", ".join(f"{c}: {k}" for c, k in Counter(n.category for n in items).most_common())
    span = f"{items[-1].article_id}–{items[0].article_id}" if items else "none"
    survey.note(
        "notices",
        f"{len(items)} articles on the listing (ids {span}; {cats}). Older articles aren't "
        "listed; their ids are sequential, so a back-fill could walk ids, at about 2.5 s each.",
    )
    log(f"notices: {len(items)} articles")


def discover(client: PoliteClient, survey: Survey, log: Callable[[str], None]) -> None:
    _debates(client, survey, log)
    _hub(client, survey, log)
    _drafts(client, survey, log)
    _notices(client, survey, log)
    _agendas(client, survey, log)
    _minutes(client, survey, log, step=1)
