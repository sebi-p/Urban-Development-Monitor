"""Official identifiers in document text (PLAN §7 stage 5, M3.2): urbanism certificate (CU)
numbers with their dates, land-register (CF) and cadastral numbers.

Only identifiers of the project itself are kept. HCL numbers in planning documents mostly cite
earlier plans ("PUZ aprobat cu HCL nr. 198/2015"), so they're left to the linker (M3.3), which
takes adopted-decision numbers from council sources.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

from mdu.core.enums import IdentifierScheme
from mdu.core.streets import fold

_DATE = r"(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})"
_CU = re.compile(
    rf"(?:\bc\.?\s?u\.?|certificat\w* de urbanism)\s*(?:nr\.?|numarul)?\s*(\d{{2,6}})\s*"
    rf"(?:/|din(?: data de)?)\s*{_DATE}",
    re.I,
)
_CF = re.compile(r"\bc\.?\s?f\.?\s*(?:nr\.?)?\s*(\d{5,7})\b", re.I)
_CADASTRAL = re.compile(r"\bnr\.?\s*cad(?:astral)?\.?\s*(?:nr\.?)?\s*(\d{5,7})\b", re.I)


@dataclass(frozen=True)
class Found:
    scheme: IdentifierScheme
    value: str
    issued_on: date | None
    page: int


def _date(d: str, m: str, y: str) -> date | None:
    year = int(y) + (2000 if len(y) == 2 else 0)  # noqa: PLR2004
    try:
        return date(year, int(m), int(d))
    except ValueError:
        return None


def find_identifiers(pages: list[str]) -> list[Found]:
    """Identifiers per page (1-based), first occurrence of each (scheme, value) kept."""
    out: dict[tuple[str, str], Found] = {}
    for n, text in enumerate(pages, start=1):
        folded = fold(text)
        for m in _CU.finditer(folded):
            issued = _date(m.group(2), m.group(3), m.group(4))
            value = f"{int(m.group(1))}/{issued.isoformat() if issued else m.group(4)}"
            out.setdefault(("cu", value), Found("cu", value, issued, n))
        for m in _CF.finditer(folded):
            out.setdefault(("cf", m.group(1)), Found("cf", m.group(1), None, n))
        for m in _CADASTRAL.finditer(folded):
            out.setdefault(("nr_cadastral", m.group(1)), Found("nr_cadastral", m.group(1), None, n))
    return list(out.values())
