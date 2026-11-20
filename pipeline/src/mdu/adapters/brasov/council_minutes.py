"""Council session minutes (P1). See docs/sources/brasov.md#council_minutes."""

import re
from dataclasses import dataclass
from datetime import date

from mdu.adapters.brasov.common import BASE_URL, absolute, clean, parse, parse_ro_date

LISTING_URL = f"{BASE_URL}/consiliul-local/procese-verbale-sedinte/"
_NUMBER = re.compile(r"CMBV-PV-(\d+)\.pdf", re.I)


def minutes_url(number: int) -> str:
    return f"{BASE_URL}/file-zone/procese-verbale/consiliu/CMBV-PV-{number}.pdf"


@dataclass(frozen=True)
class MinutesLink:
    number: int
    url: str
    session_date: date | None
    label: str


def parse_listing(html: bytes | str) -> list[MinutesLink]:
    out = []
    for a in parse(html).css("a[href*='CMBV-PV-']"):
        url = absolute(a.attributes.get("href") or "")
        m = _NUMBER.search(url)
        if m:
            label = clean(a)
            out.append(MinutesLink(int(m.group(1)), url, parse_ro_date(label), label))
    return sorted({x.number: x for x in out}.values(), key=lambda x: -x.number)


_SESSION_DATE = re.compile(
    r"(?:din\s+(?:data\s+de\s+)?|ziua\s+de\s+)"
    r"(\d{1,2}(?:[.\-/]\d{1,2}[.\-/]|\s+[A-Za-zăâîșțşţ]{3,10}\s+)\d{4})",
    re.I,
)


def session_date_from_text(text: str) -> date | None:
    """Session date from the first page of a minutes PDF: '... din data de 30 august 2013'
    or '... din data de 25.09.2026'."""
    m = _SESSION_DATE.search(text)
    return parse_ro_date(m.group(1)) if m else None
