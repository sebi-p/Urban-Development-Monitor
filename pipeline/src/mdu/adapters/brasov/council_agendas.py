"""Proposed council session agendas (P0). See docs/sources/brasov.md#council_agendas."""

import re
from dataclasses import dataclass, field
from datetime import date

from mdu.adapters.brasov.common import BASE_URL, clean, main_content, parse, parse_ro_date

LATEST_KNOWN_ID = 470  # 2026-11-20; the daily run probes upwards from the newest id it has seen


def agenda_url(session_id: int) -> str:
    return f"{BASE_URL}/consiliu/proiect-al-ordinii-de-zi/{session_id}"


def session_id_of(url: str) -> int | None:
    m = re.search(r"/proiect-al-ordinii-de-zi/(\d+)/?$", url)
    return int(m.group(1)) if m else None


@dataclass(frozen=True)
class AgendaItem:
    number: int
    title: str


@dataclass(frozen=True)
class Agenda:
    session_date: date | None
    entries: list[AgendaItem] = field(default_factory=list)

    @property
    def items(self) -> int:
        return len(self.entries)


_DATE = re.compile(r"va avea loc în ziua de\s+(\d{1,2}[.\-]\d{1,2}[.\-]\d{4})", re.I)
_NUMBER = re.compile(r"(\d{1,3})\.")
_HEADING = "PROIECT AL ORDINII DE ZI"


def parse_agenda(html: bytes | str) -> Agenda | None:
    """None when the page is only the site template (old ids keep no agenda). Items are the
    numbered entries after the 'PROIECT AL ORDINII DE ZI' heading, in the main content only
    (every page's sidebar repeats the current agenda)."""
    main = main_content(parse(html))
    text = main.text(separator="\n")
    if "ORDINII DE ZI" not in text.upper() or "Proiect de hotărâre" not in text:
        return None
    m = _DATE.search(clean(main))
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    starts = [i for i, line in enumerate(lines) if line.upper() == _HEADING]
    entries: list[AgendaItem] = []
    if starts:
        current: tuple[int, list[str]] | None = None
        parts: list[tuple[int, list[str]]] = []
        for line in lines[starts[-1] + 1 :]:
            number = _NUMBER.fullmatch(line)
            if number:
                current = (int(number.group(1)), [])
                parts.append(current)
            elif current is not None:
                current[1].append(line)
        entries = [AgendaItem(n, re.sub(r"\s+", " ", " ".join(t)).strip()) for n, t in parts if t]
    return Agenda(session_date=parse_ro_date(m.group(1)) if m else None, entries=entries)


def title_key(title: str) -> str:
    """Normalised core of a draft-decision title, so the agenda wording ('Proiect de hotărâre
    pentru … P.U.Z. … în mun. Brașov …, inițiator X') matches the public-debate wording
    ('PROIECT DE HOTĂRÂRE AL CONSILIULUI LOCAL pentru … PUZ … în municipiul Brașov …')."""
    from mdu.core.streets import fold  # noqa: PLC0415

    s = fold(title)
    s = re.sub(r"[„”“\"'`]", " ", s)
    s = re.sub(r"\bp\.?\s?u\.?\s?([zd])\b\.?", r"pu\1", s)
    s = re.sub(r"\bmun\.\s*", "municipiul ", s)
    s = re.split(r",?\s*\binitiator(?:ul)?\b", s)[0]
    s = re.sub(
        r"^proiect(?:ul)?\s+(?:de\s+hotarare\s+)?(?:al?\s+consiliului\s+local\s+"
        r"(?:al\s+municipiului\s+brasov\s+)?)?(?:pentru|privind)\s*:?\s*",
        "",
        s,
    )
    s = re.sub(r"[^\w\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()
