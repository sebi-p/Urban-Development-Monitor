"""Document classifier (PLAN §7 stage 4, M3.1; ADR 0008).

Rules first: the listing label (the link text the city gives the file), then the first pages'
headings, then the page shape (drawing sheets: one large page, mostly numbers or a CAD stamp).
Documents no rule recognises go to the LLM fallback (`mdu.core.llm`) when one is configured,
otherwise they're `other` with low confidence for the review queue (M3.5).

The names are those of Romanian planning procedure (Law 350/2001, Law 52/2003, CATUC), not of one
city, so the rules live in the core.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from mdu.core.enums import Confidence, DocumentRole
from mdu.core.streets import fold

# Bump when rules change; documents classified by an older version are classified again.
CLASSIFIER_VERSION = "rules-1"
FIRST_PAGES = 2
LLM_TEXT_CHARS = 2000

Method = Literal["label", "text", "shape", "llm", "none"]


@dataclass(frozen=True)
class ClassifyInput:
    label: str  # listing link text; "" when unknown
    first_pages: str  # text of the first FIRST_PAGES pages
    page_count: int
    chars_per_page: float

    @property
    def llm_excerpt(self) -> str:
        return self.first_pages[:LLM_TEXT_CHARS]


@dataclass(frozen=True)
class Classification:
    doc_type: DocumentRole
    method: Method
    confidence: Confidence
    rule: str


def _r(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.I)


# Matched against the folded label (no diacritics, lower case, leading "07." numbering removed).
# Order matters: the first match wins.
LABEL_RULES: list[tuple[DocumentRole, re.Pattern[str]]] = [
    ("registru_opinii", _r(r"\bregistr\w*\b")),
    ("ordine_zi_comisie", _r(r"ordinea de zi.*(ctatu|comisi)|(ctatu|comisi).*ordinea de zi")),
    ("hotarari_comisie", _r(r"hotarari\w*\s+(ctatu|comisi)|\bctatu\b.*hotarari")),
    ("referat_aprobare", _r(r"\breferat\w*")),
    ("raport_specialitate", _r(r"\braport\w*\s+(de\s+)?specialitat")),
    ("raport_consultare", _r(r"\braport\w*.*(52|transparent|dezbater|consult|informar)")),
    ("anunt", _r(r"\banunt\w*")),
    ("proiect_hcl", _r(r"\bproiect\w*\s+(de\s+)?hot|\bphcl\b|^proiect$")),
    ("hcl", _r(r"^(hcl|hotararea?)\b(?!.*\bproiect)")),
    ("memoriu", _r(r"\bm\s?e\s?m\s?o\s?r\s?i\s?u\b|\bparte\w* scris")),
    ("rlu", _r(r"\bregulament\w*|\brlu\b")),
    ("plansa_reglementari", _r(r"\breglem\w*")),
    ("certificat_urbanism", _r(r"certificat\w* de urbanism|^c\.?u\.?\b")),
    ("studiu", _r(r"studi\w*|geoteh|\btopo|expertiz|ridicare")),
    ("aviz", _r(r"\baviz(?!at)\w*|\bacord\w*|\bdecizi\w*")),
    (
        "plansa",
        _r(
            r"\bplans\w*|mobilar|incadr|incad\w* in|edilitar|existent|ilustr|situati\w* "
            r"(existent|propus)|circulati|profil\w* (transversal|stradal)|retele"
        ),
    ),
]

# Matched against the folded first pages. Headings that open a document.
TEXT_RULES: list[tuple[DocumentRole, re.Pattern[str]]] = [
    ("referat_aprobare", _r(r"referat de aprobare")),
    ("raport_specialitate", _r(r"raport\w* de specialitate")),
    ("raport_consultare", _r(r"legii nr\.? ?52/2003|raport\w* (al )?dezbaterii publice")),
    ("ordine_zi_comisie", _r(r"comisia tehnica de amenajare.{0,200}ordinea de zi")),
    ("hotarari_comisie", _r(r"comisia tehnica de amenajare.{0,300}sedinta comisiei")),
    ("rlu", _r(r"regulament\w* (local de urbanism|aferent)")),
    (
        "memoriu",
        _r(
            r"memoriu (tehnic|general|justificativ|de prezentare)|m e m o r i u|foaie de prezentare"
        ),
    ),
    ("anunt", _r(r"\banunt (de )?(informare|dezbatere|referitor)")),
    ("proiect_hcl", _r(r"proiect de hotarare al consiliului local")),
    ("studiu", _r(r"plan topografic|studiu geotehnic|ridicare topografica")),
]

_DRAWING_STAMP = _r(r"gspublisherversion|desenat|proiectat|scara 1:\d+|plansa nr")
_NUMERIC = re.compile(r"[\d.,]+")


def _clean_label(label: str) -> str:
    folded = fold(label).replace("_", " ")
    folded = re.sub(r"\.pdf$", "", folded.strip())
    return re.sub(r"^\s*\d{1,3}(?!\d)\s*[.)\-]?\s*", "", folded).strip()


def _looks_like_drawing(inp: ClassifyInput, text: str) -> str | None:
    if inp.page_count > 2:  # noqa: PLR2004 - drawing sets come one sheet per file
        return None
    if _DRAWING_STAMP.search(text[:600]):
        return "drawing stamp"
    tokens = text.split()
    if tokens and sum(bool(_NUMERIC.fullmatch(t)) for t in tokens) > 0.4 * len(tokens):
        return "mostly dimensions"
    return None


def classify_rules(inp: ClassifyInput) -> Classification | None:
    label = _clean_label(inp.label)
    for doc_type, pattern in LABEL_RULES:
        if label and pattern.search(label):
            return Classification(doc_type, "label", "high", pattern.pattern)
    text = fold(inp.first_pages)
    head = " ".join(text.split())[:3000]
    for doc_type, pattern in TEXT_RULES:
        if pattern.search(head):
            return Classification(doc_type, "text", "high", pattern.pattern)
    why = _looks_like_drawing(inp, text)
    if why:
        return Classification("plansa", "shape", "medium", why)
    return None


def classify_without_llm(inp: ClassifyInput) -> Classification:
    found = classify_rules(inp)
    return found or Classification("other", "none", "low", "no rule matched")
