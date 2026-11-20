"""Helpers shared by the Brașov adapters (PLAN §7: city specifics live under adapters/brasov)."""

import re
from datetime import date
from urllib.parse import urljoin

from selectolax.lexbor import LexborHTMLParser, LexborNode

BASE_URL = "https://www.brasovcity.ro"

_MONTHS = {
    "ian": 1, "feb": 2, "mar": 3, "apr": 4, "mai": 5, "iun": 6,
    "iul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10, "noi": 11, "nov": 11, "dec": 12,
}  # fmt: skip
_UNITS = {"b": 1, "kb": 1024, "mb": 1024**2, "gb": 1024**3}
_SIZE = re.compile(r"\[\s*([\d.,]+)\s*(B|KB|MB|GB)\s*\]", re.I)
# "03 Noi 2026", "12 Sept 2025" and full names such as "30 august 2013" / "25 septembrie 2026".
_RO_DATE = re.compile(r"(\d{1,2})\s+([A-Za-zăâîșțşţĂÂÎȘȚŞŢ]{3,10})\.?\s+(\d{4})")
_NUM_DATE = re.compile(r"(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})")


def parse(html: bytes | str) -> LexborHTMLParser:
    text = html.decode("utf-8", errors="replace") if isinstance(html, bytes) else html
    return LexborHTMLParser(text)


def absolute(href: str, base: str = BASE_URL) -> str:
    return urljoin(base + "/", href.strip())


def parse_size(text: str) -> int | None:
    """'[116.08 KB]' -> bytes (approximate, as shown by the site)."""
    m = _SIZE.search(text)
    if not m:
        return None
    return round(float(m.group(1).replace(",", ".")) * _UNITS[m.group(2).lower()])


_FULL_MONTHS = (
    "ianuarie", "februarie", "martie", "aprilie", "mai", "iunie",
    "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie",
)  # fmt: skip


def _month(word: str) -> int | None:
    w = word.lower().rstrip(".")
    if w in _MONTHS:
        return _MONTHS[w]
    if w in _FULL_MONTHS:
        return _FULL_MONTHS.index(w) + 1
    return None


def parse_ro_date(text: str) -> date | None:
    """'03 Noi 2026', '30 august 2013', '25-09-2026' or '25.09.2026' -> date."""
    for m in _RO_DATE.finditer(text):
        month = _month(m.group(2))
        if month:
            return date(int(m.group(3)), month, int(m.group(1)))
    num = _NUM_DATE.search(text)
    if num:
        day, month, year = int(num.group(1)), int(num.group(2)), int(num.group(3))
        if 1 <= month <= 12 and 1 <= day <= 31:  # noqa: PLR2004
            return date(year, month, day)
    return None


def clean(node: LexborNode | None) -> str:
    if node is None:
        return ""
    return re.sub(r"\s+", " ", node.text(separator=" ")).strip()


def main_content(tree: LexborHTMLParser) -> LexborNode:
    """The page body without the site-wide sidebar (which repeats the current council agenda)."""
    for selector in ("main", "div.main", "#main", "article"):
        node = tree.css_first(selector)
        if node is not None:
            return node
    body = tree.body
    assert body is not None
    return body
