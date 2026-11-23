"""Plain-language project summaries (PLAN §1 "plain language first", M4.2).

One LLM call per project writes two or three neutral sentences in Romanian and English from the
project's checked fields and the most useful pages of its documents (`fields.select_pages`). A
summary is kept only when:

- every number in it is written in the input, so it adds no figures;
- it uses none of the evaluative words in `EVALUATIVE` (PLAN §11: describe, never campaign);
- it names no one: a run of two or more capitalised words must come from the title, address,
  initiator, designer or city name, or contain a word such as "Strada" or "Consiliul"; anything
  else may be a private person's name (PLAN §11);
- it cites one of the documents it was given, whose link the page shows as the source.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from mdu.core.fields import Selection, numbers_in
from mdu.core.streets import fold
from mdu.ingest import looks_like_organisation

PROMPT_VERSION = "summary-v1"
MAX_CHARS = 9_000
MIN_LEN, MAX_LEN = 40, 600

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary_ro": {"type": "string"},
        "summary_en": {"type": "string"},
        "doc": {"type": "integer"},
        "page": {"type": "integer"},
    },
    "required": ["summary_ro", "summary_en", "doc", "page"],
    "additionalProperties": False,
}

# Folded (no diacritics, lower case) words that judge rather than describe, matched with their
# inflections only ("benefic", "benefica", not "beneficiar"; "modern", not "modernizare").
EVALUATIVE = (
    "important", "impresionant", "spectaculos", "frumos", "modern", "benefic", "excelent",
    "controversat", "ambitios", "valoros", "deosebit", "remarcabil", "binevenit",
    "problematic", "excesiv", "abuziv", "ilegal", "minunat", "prestigios", "luxos",
    "impressive", "spectacular", "beautiful", "beneficial", "excellent", "controversial",
    "ambitious", "remarkable", "welcome", "excessive", "illegal", "luxury", "stunning", "iconic",
)  # fmt: skip
_EVALUATIVE = re.compile(
    r"\b(" + "|".join(EVALUATIVE) + r")(a|e|i|ul|ului|ii|ilor|ele|elor|o|ly|ally|s)?\b", re.I
)

# Words that make a capitalised run a place, a body or a plan rather than a person.
GENERIC_WORDS = (
        "strada", "str", "calea", "bulevardul", "bd", "aleea", "piata", "soseaua", "drumul",
        "cartierul", "zona", "municipiul", "orasul", "judetul", "romania", "consiliul", "local",
        "primaria", "planul", "plan", "urbanistic", "zonal", "detaliu", "general", "regulamentul",
        "hotararea", "hotarare", "proiectul", "pug", "puz", "pud", "hcl", "rlu", "cu", "ac",
        "street", "avenue", "road", "square", "district", "city", "council", "zoning", "urban",
        "detailed", "municipality", "county", "the", "a", "an", "in", "on", "at", "this", "it",
        "un", "o", "pe", "la", "în", "prin", "planului", "documentatia", "documentatiei",
        "maximum", "minimum", "maxim", "minim", "pot", "cut", "industrial",
)  # fmt: skip
GENERIC = frozenset(fold(w) for w in GENERIC_WORDS)
_CAP_WORD = r"[A-ZĂÂÎȘȚŞŢ][\w-]*"
_CAP_RUN = re.compile(rf"{_CAP_WORD}(?:\s+{_CAP_WORD})+")
# A run right after one of these is a street or place named after a person ("str. Ioan Popasu").
_PLACE_AFTER = re.compile(r"^\s+(streets?|road|avenue|boulevard|square)\b", re.I)
_PLACE_BEFORE = re.compile(
    r"\b(str|strada|strazii|strazile|streets?|bd|b-dul|bulevardul|boulevard|calea|aleea|piata|"
    r"square|cartierul|zona|cartier|si|and)\.?\s*$",
    re.I,
)


def prompt_text(header: str, selection: Selection) -> str:
    return f"<project>\n{header}\n</project>\n\n{selection.prompt_text()}"


def unknown_names(text: str, allowed: str) -> list[str]:
    """Capitalised runs that may be a person's name: two or more words that are neither in
    `allowed` nor generic place or body words."""
    allowed_words = set(re.findall(r"\w+", fold(allowed)))
    out = []
    # Words never include a dot, so a run can't cross the end of a sentence ("4E. Spațiile").
    for match in _CAP_RUN.finditer(text):
        run = match.group(0)
        before = fold(text[max(0, match.start() - 14) : match.start()])
        if _PLACE_BEFORE.search(before) or _PLACE_AFTER.match(text[match.end() :]):
            continue
        # Companies and public bodies may be named; "X S.R.L." ends the run at "S".
        if looks_like_organisation(run) or re.match(
            r"\.\s?(r\.\s?l|a\b)", text[match.end() :], re.I
        ):
            continue
        words = re.findall(r"\w+", fold(run))
        if any(w in GENERIC for w in words):
            continue
        unknown = [w for w in words if w not in allowed_words]
        if len(unknown) >= 2:  # noqa: PLR2004
            out.append(run)
    return out


@dataclass
class Summary:
    ro: str | None = None
    en: str | None = None
    doc_index: int | None = None
    page: int | None = None
    dropped: list[str] = field(default_factory=list)

    @property
    def kept(self) -> bool:
        return self.ro is not None and self.en is not None


def check(answer: dict[str, Any], input_text: str, selection: Selection, allowed: str) -> Summary:
    out = Summary()
    ro, en = (str(answer.get(k) or "").strip() for k in ("summary_ro", "summary_en"))
    doc, page = answer.get("doc"), answer.get("page")
    known = numbers_in(input_text)
    for lang, text in (("ro", ro), ("en", en)):
        if not MIN_LEN <= len(text) <= MAX_LEN:
            out.dropped.append(f"{lang}: length")
        elif any(
            all(abs(n - k) > 1e-6 * max(1.0, abs(n)) for k in known) for n in numbers_in(text)
        ):
            out.dropped.append(f"{lang}: number not in the documents")
        elif _EVALUATIVE.search(fold(text)):
            out.dropped.append(f"{lang}: evaluative word")
        elif unknown_names(text, allowed):
            out.dropped.append(f"{lang}: may name a person")
    if not isinstance(doc, int) or not 0 <= doc < len(selection.documents):
        out.dropped.append("unknown document")
    elif not isinstance(page, int) or not 1 <= page <= len(selection.documents[doc].pages):
        out.dropped.append("unknown page")
    if not out.dropped:
        out.ro, out.en, out.doc_index, out.page = ro, en, doc, page
    return out
