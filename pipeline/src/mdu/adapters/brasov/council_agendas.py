"""Proposed council session agendas (P0). See docs/sources/brasov.md#council_agendas."""

import re
from dataclasses import dataclass
from datetime import date

from mdu.adapters.brasov.common import BASE_URL, clean, main_content, parse, parse_ro_date

LATEST_KNOWN_ID = 470  # 2026-11-20; the inventory probes around it


def agenda_url(session_id: int) -> str:
    return f"{BASE_URL}/consiliu/proiect-al-ordinii-de-zi/{session_id}"


@dataclass(frozen=True)
class Agenda:
    session_date: date | None
    items: int


_DATE = re.compile(r"va avea loc în ziua de\s+(\d{1,2}[.\-]\d{1,2}[.\-]\d{4})", re.I)
_ITEM = re.compile(r"^\s*\d{1,3}\.\s*$", re.M)


def parse_agenda(html: bytes | str) -> Agenda | None:
    """None when the page is only the site template (old ids keep no agenda)."""
    main = main_content(parse(html))
    text = main.text(separator="\n")
    if "ORDINII DE ZI" not in text.upper() or "Proiect de hotărâre" not in text:
        return None
    m = _DATE.search(clean(main))
    return Agenda(
        session_date=parse_ro_date(m.group(1)) if m else None,
        items=len(_ITEM.findall(text)),
    )
