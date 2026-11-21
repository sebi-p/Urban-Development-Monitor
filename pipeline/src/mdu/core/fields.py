"""Project fields from document text (PLAN §7 stage 5, M3.2; ADR 0009).

For each project the most useful pages of its documents are selected (the start of the draft
decision and the technical report, then the pages that mention indicators, from the technical
report, memoriu and regulations), up to `MAX_CHARS`. One LLM call returns each field with the
document and page it is on and a short quote. A value is kept only when its quote is found on that
page and, for numbers, the number is in the quote, so the model can't add values that aren't in
the documents. Initiator and designer are kept only when they name an organisation (PLAN §11).
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from mdu.core.streets import fold
from mdu.ingest import looks_like_organisation

PROMPT_VERSION = "fields-v1"
MAX_CHARS = 12_000
MAX_PAGE_CHARS = 3_500

# Document types worth reading, in order of how densely they state the facts.
READ_ORDER = ("raport_specialitate", "proiect_hcl", "referat_aprobare", "memoriu", "rlu")
ALWAYS_FIRST_PAGE = ("raport_specialitate", "proiect_hcl")

_KEYWORDS = re.compile(
    r"\bp\.?\s?o\.?\s?t\b|\bc\.?\s?u\.?\s?t\b|regim\w* de inaltime|inaltime\w* maxim|\bh\s?max|"
    r"suprafat\w* (terenului|studiat|totala|de teren)|locuri de parcare|\bparcar\w*|"
    r"spati\w* verzi|apartament|unitat\w* locativ|beneficiar|initiator|proiectant|elaborator",
    re.I,
)

NUMBER_FIELDS = (
    "site_area_m2",
    "pot_percent",
    "cut",
    "max_height_m",
    "dwellings",
    "parking_spaces",
    "green_space_percent",
)
TEXT_FIELDS = ("initiator", "designer", "height_regime")
FIELDS = TEXT_FIELDS + NUMBER_FIELDS


@dataclass(frozen=True)
class SourceDocument:
    raw_document_id: str
    doc_type: str
    pages: list[str]  # page texts, 1-based numbering = index + 1


@dataclass(frozen=True)
class SelectedPage:
    doc_index: int  # index into the documents list
    page: int  # 1-based
    text: str


@dataclass
class Selection:
    documents: list[SourceDocument]
    pages: list[SelectedPage] = field(default_factory=list)

    def prompt_text(self) -> str:
        parts = []
        for p in self.pages:
            doc = self.documents[p.doc_index]
            parts.append(
                f'<page doc="{p.doc_index}" type="{doc.doc_type}" n="{p.page}">\n{p.text}\n</page>'
            )
        return "\n\n".join(parts)


def select_pages(documents: Sequence[SourceDocument], max_chars: int = MAX_CHARS) -> Selection:
    docs = sorted(
        (d for d in documents if d.doc_type in READ_ORDER),
        key=lambda d: READ_ORDER.index(d.doc_type),
    )
    selection = Selection(list(docs))
    chosen: set[tuple[int, int]] = set()
    budget = max_chars

    def take(doc_index: int, page: int) -> None:
        nonlocal budget
        text = docs[doc_index].pages[page - 1][:MAX_PAGE_CHARS]
        if (doc_index, page) in chosen or not text.strip() or len(text) > budget:
            return
        chosen.add((doc_index, page))
        selection.pages.append(SelectedPage(doc_index, page, text))
        budget -= len(text)

    for i, d in enumerate(docs):
        if d.doc_type in ALWAYS_FIRST_PAGE and d.pages:
            take(i, 1)
    scored = [
        (len(_KEYWORDS.findall(fold(text))), -READ_ORDER.index(d.doc_type), i, n)
        for i, d in enumerate(docs)
        for n, text in enumerate(d.pages, start=1)
    ]
    for hits, _, i, n in sorted(scored, reverse=True):
        if hits == 0:
            break
        take(i, n)
    selection.pages.sort(key=lambda p: (p.doc_index, p.page))
    return selection


def _value_schema(kind: str) -> dict[str, Any]:
    return {
        "anyOf": [
            {"type": "null"},
            {
                "type": "object",
                "properties": {
                    "value": {"type": kind},
                    "doc": {"type": "integer"},
                    "page": {"type": "integer"},
                    "quote": {"type": "string"},
                },
                "required": ["value", "doc", "page", "quote"],
                "additionalProperties": False,
            },
        ]
    }


SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        **{f: _value_schema("string") for f in TEXT_FIELDS},
        **{f: _value_schema("number") for f in NUMBER_FIELDS},
    },
    "required": list(FIELDS),
    "additionalProperties": False,
}


_NAME_SPLIT = re.compile(
    r"\s*(?:,|;|\bsi\b|\bși\b|\bprin\b|\bpentru\b|\breprezentant\w*|\bin numele)\s*", re.I
)


def organisations_in(name: str) -> list[str]:
    """The parts of a name that are organisations: 'Cozma Calin reprezentant DECENT REAL
    ESTATE' -> ['DECENT REAL ESTATE']; 'Ion Pop și alții' -> []. People's names are dropped."""
    return [
        part.strip(" .")
        for part in _NAME_SPLIT.split(name)
        if part and looks_like_organisation(part)
    ]


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w%,.+/]", " ", fold(text))).strip()


def numbers_in(text: str) -> set[float]:
    """Every reading of the numbers in a Romanian text: '1.855,00' -> 1855; '30.90m' -> 30.9;
    '0,80' -> 0.8; '14 487' -> 14487; '12.500' -> 12500 or 12.5 (a lone dot before 3 digits is
    ambiguous)."""
    out: set[float] = set()
    for spaced in re.findall(r"\b\d{1,3}(?: \d{3})+\b", text):  # '14 487 mp'
        out.add(float(spaced.replace(" ", "")))
    for token in re.findall(r"\d+(?:[.,]\d+)*", text):
        readings = []
        if "," in token and "." in token:  # 1.855,00: dots group thousands, comma is decimal
            readings.append(token.replace(".", "").replace(",", "."))
        elif token.count(",") == 1:
            readings.append(token.replace(",", "."))
        elif token.count(".") == 1:
            readings.append(token)
            if re.fullmatch(r"\d{1,3}\.\d{3}", token):
                readings.append(token.replace(".", ""))
        else:
            readings.append(token.replace(".", "").replace(",", ""))
        for r in readings:
            try:
                out.add(float(r))
            except ValueError:
                continue
    return out


def _number_in(value: float, quote: str) -> bool:
    """The value is one of the numbers written in the quote."""
    return any(abs(n - value) <= 1e-6 * max(1.0, abs(value)) for n in numbers_in(quote))


@dataclass(frozen=True)
class Value:
    field: str
    value: Any
    raw_document_id: str
    page: int
    quote: str


@dataclass
class Checked:
    kept: list[Value] = field(default_factory=list)
    dropped: dict[str, str] = field(default_factory=dict)  # field -> reason


def check(answer: dict[str, Any], selection: Selection) -> Checked:
    """Keep only values whose quote is on the cited page (and whose number is in the quote)."""
    out = Checked()
    for name in FIELDS:
        item = answer.get(name)
        if not item:
            continue
        doc_index, page, quote = item.get("doc"), item.get("page"), item.get("quote") or ""
        value = item.get("value")
        if not isinstance(doc_index, int) or not 0 <= doc_index < len(selection.documents):
            out.dropped[name] = "unknown document"
            continue
        doc = selection.documents[doc_index]
        if not isinstance(page, int) or not 1 <= page <= len(doc.pages):
            out.dropped[name] = "unknown page"
            continue
        if len(_norm(quote)) < 3 or _norm(quote) not in _norm(doc.pages[page - 1]):  # noqa: PLR2004
            out.dropped[name] = "quote not on the cited page"
            continue
        if name in NUMBER_FIELDS and not (
            isinstance(value, int | float) and value > 0 and _number_in(float(value), quote)
        ):
            out.dropped[name] = "number not in the quote"
            continue
        if name in ("initiator", "designer"):
            organisations = organisations_in(str(value))
            if organisations:
                value = ", ".join(organisations)
            elif name == "initiator":
                value = "persoană fizică"  # PLAN §11: never a private person's name
            else:
                out.dropped[name] = "not an organisation"
                continue
        out.kept.append(Value(name, value, doc.raw_document_id, page, quote))
    return out
