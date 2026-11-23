"""Public consultations from the city's notices (M4.2; ADR 0009 method, PLAN §6 `consultation`).

A notice ("anunț") states when residents can comment, until when, where to send comments and,
sometimes, the date and place of a public meeting. One LLM call per notice returns each value
with its page and a short quote copied from the page. A value is kept only when its quote is on
that page and the date (or the email address) is written in the quote; a closing date given as
"within N days" must equal the opening date plus N. Emails at free webmail providers are dropped:
the city's addresses are what residents need, and a personal address would name a person.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

from mdu.core.fields import _norm, numbers_in
from mdu.core.streets import fold
from mdu.ingest import looks_personal

PROMPT_VERSION = "consult-v1"
MAX_CHARS = 8_000

DATE_FIELDS = ("opens_on", "closes_on")
TEXT_FIELDS = ("submit_email", "submit_address", "submit_instructions", "public_meeting_place")
FIELDS = (*DATE_FIELDS, "public_meeting_at", *TEXT_FIELDS)

MONTH_NAMES = (
    "ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august",
    "septembrie", "octombrie", "noiembrie", "decembrie",
)  # fmt: skip
_MONTHS = {m: i + 1 for i, name in enumerate(MONTH_NAMES) for m in (name, name[:3])}
_NUMERIC_DATE = re.compile(r"\b(\d{1,2})\s?[./-]\s?(\d{1,2})(?:\s?[./-]\s?(\d{2,4}))?\b")
_WORD_DATE = re.compile(r"\b(\d{1,2})\s+([a-z]{3,10})\.?(?:\s+(\d{4}))?\b")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
FREE_MAIL = ("gmail.", "yahoo.", "hotmail.", "outlook.", "live.", "icloud.", "mail.ru", "ymail.")
MIN_TEXT = 3


def dates_in(text: str) -> set[tuple[int | None, int, int]]:
    """(year or None, month, day) of every date written in the text: '18.03.2019', '8/7/21',
    '15 martie 2024', 'până la 15.12'."""
    out: set[tuple[int | None, int, int]] = set()
    folded = fold(text)
    for d, m, y in _NUMERIC_DATE.findall(folded):
        year = int(y) + (2000 if len(y) == 2 else 0) if y else None  # noqa: PLR2004
        if 1 <= int(m) <= 12 and 1 <= int(d) <= 31:  # noqa: PLR2004
            out.add((year, int(m), int(d)))
    for d, word, y in _WORD_DATE.findall(folded):
        month = _MONTHS.get(word)
        if month and 1 <= int(d) <= 31:  # noqa: PLR2004
            out.add((int(y) if y else None, month, int(d)))
    return out


def _date_in(value: date, quote: str) -> bool:
    found = dates_in(quote)
    return any((m, d) == (value.month, value.day) and y in (None, value.year) for y, m, d in found)


def _item_schema(*, days: bool = False) -> dict[str, Any]:
    props: dict[str, Any] = {
        "value": {"type": "string"},
        "page": {"type": "integer"},
        "quote": {"type": "string"},
    }
    if days:
        props["days_after_opening"] = {"anyOf": [{"type": "integer"}, {"type": "null"}]}
    return {
        "anyOf": [
            {"type": "null"},
            {
                "type": "object",
                "properties": props,
                "required": list(props),
                "additionalProperties": False,
            },
        ]
    }


SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "opens_on": _item_schema(),
        "closes_on": _item_schema(days=True),
        "public_meeting_at": _item_schema(),
        **{f: _item_schema() for f in TEXT_FIELDS},
    },
    "required": list(FIELDS),
    "additionalProperties": False,
}


@dataclass(frozen=True)
class Kept:
    value: Any  # date, datetime (naive, local time) or str
    page: int
    quote: str


@dataclass
class Consultation:
    values: dict[str, Kept] = field(default_factory=dict)
    dropped: dict[str, str] = field(default_factory=dict)

    @property
    def found(self) -> bool:
        """The notice states when or where residents can take part."""
        return any(k in self.values for k in ("closes_on", "opens_on", "public_meeting_at"))

    @property
    def page(self) -> int | None:
        for name in ("closes_on", "opens_on", "public_meeting_at"):
            if name in self.values:
                return self.values[name].page
        return None


def prompt_text(pages: list[str], max_chars: int = MAX_CHARS) -> str:
    parts, budget = [], max_chars
    for n, text in enumerate(pages, start=1):
        if not text.strip() or len(text) > budget:
            continue
        parts.append(f'<page n="{n}">\n{text}\n</page>')
        budget -= len(text)
    return "\n\n".join(parts)


def _parse_date(value: Any) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _check_one(name: str, item: dict[str, Any], page_text: str) -> Any:  # noqa: PLR0911, PLR0912
    """The checked value, or a reason string prefixed with '!' to drop it."""
    quote, value = item.get("quote") or "", item.get("value")
    if len(_norm(quote)) < MIN_TEXT or _norm(quote) not in _norm(page_text):
        return "!quote not on the cited page"
    if name in DATE_FIELDS:
        parsed = _parse_date(value)
        if parsed is None:
            return "!not a date"
        if item.get("days_after_opening") is None and not _date_in(parsed, quote):
            return "!date not in the quote"
        return parsed
    if name == "public_meeting_at":
        try:
            when = datetime.fromisoformat(str(value))
        except ValueError:
            return "!not a date and time"
        if not _date_in(when.date(), quote):
            return "!date not in the quote"
        if when.hour and when.hour not in {int(n) for n in numbers_in(quote)}:
            return "!time not in the quote"
        return when
    text = str(value or "").strip()
    if len(_norm(text)) < MIN_TEXT:
        return "!empty"
    if name == "submit_email":
        email = text.lower()
        if not _EMAIL.fullmatch(email) or email not in quote.lower().replace(" ", ""):
            return "!email not in the quote"
        if any(domain in email.split("@")[1] for domain in FREE_MAIL):
            return "!personal email"
        return email
    if _norm(text) not in _norm(page_text):
        return "!not copied from the page"
    if looks_personal(text):
        return "!names a person"
    return text


def check(answer: dict[str, Any], pages: list[str]) -> Consultation:
    out = Consultation()
    for name in FIELDS:
        item = answer.get(name)
        if not item:
            continue
        page = item.get("page")
        if not isinstance(page, int) or not 1 <= page <= len(pages):
            out.dropped[name] = "unknown page"
            continue
        result = _check_one(name, item, pages[page - 1])
        if isinstance(result, str) and result.startswith("!"):
            out.dropped[name] = result[1:]
            continue
        out.values[name] = Kept(result, page, item.get("quote") or "")
    # "Within N days": N is in the quote and the date is the opening date plus N (the first or
    # the last day counted, both are used in practice).
    closes = answer.get("closes_on") or {}
    days = closes.get("days_after_opening")
    if "closes_on" in out.values and days is not None:
        opens = out.values.get("opens_on")
        ok = (
            isinstance(days, int)
            and days > 0
            and float(days) in numbers_in(out.values["closes_on"].quote)
            and opens is not None
            and abs((out.values["closes_on"].value - opens.value) - timedelta(days=days))
            <= timedelta(days=1)
        )
        if not ok:
            del out.values["closes_on"]
            out.dropped["closes_on"] = "day count doesn't match the opening date"
    opens, closes = out.values.get("opens_on"), out.values.get("closes_on")
    if opens and closes and closes.value < opens.value:
        del out.values["closes_on"]
        out.dropped["closes_on"] = "closes before it opens"
    return out
