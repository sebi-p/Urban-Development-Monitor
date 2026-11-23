"""Text extraction from PDFs, page by page (PLAN §7 stage 3, M2.3; ADR 0006).

PyMuPDF reads each page's text layer. Pages with almost no text but with images are scans, so
they are run through Tesseract with Romanian language data via PyMuPDF's built-in OCR. Large
drawing sheets (plan sheets bigger than A3) are not OCR'd: they hold little running text and take
long. Every page keeps its number, because extracted values must cite the page they came from.
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter
from dataclasses import asdict, dataclass, field
from typing import Literal

import pymupdf

# Bump when the output changes; documents extracted by an older version are processed again.
EXTRACTOR_VERSION = 1
OCR_LANGUAGE = "ron"
OCR_DPI = 300
MIN_TEXT_CHARS = 100  # a page with fewer characters and an image is treated as a scan
A3_AREA = 842 * 1191  # points²
MAX_OCR_AREA = A3_AREA * 1.1
MAX_OCR_PAGES = 80
HEAD_CHARS = 8000

Method = Literal["text", "ocr", "none"]

# Old Romanian encodings used ş/ţ with a cedilla; the correct letters have a comma below.
_CEDILLA = str.maketrans("şŞţŢ", "șȘțȚ")
_HYPHEN_BREAK = re.compile(r"(\w)-\n(\w)")
_SPACES = re.compile("[ \t\u00a0]+")
_BLANK_LINES = re.compile(r"\n{3,}")
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


class ExtractionError(RuntimeError):
    """The file can't be read as a PDF (corrupt, encrypted, not a PDF)."""


@dataclass
class PageText:
    n: int  # 1-based page number
    text: str
    method: Method
    note: str | None = None


@dataclass
class DocumentText:
    pages: list[PageText]
    version: int = EXTRACTOR_VERSION
    ocr_pages: int = 0
    skipped_pages: dict[str, int] = field(default_factory=dict)
    total_pages: int | None = None  # pages in the file (more than `pages` when max_pages was set)

    @property
    def ocr_used(self) -> bool:
        return self.ocr_pages > 0

    @property
    def text(self) -> str:
        return "\n\f\n".join(p.text for p in self.pages)

    def head(self, chars: int = HEAD_CHARS) -> str:
        return self.text[:chars]

    def to_json(self) -> bytes:
        data = {
            "version": self.version,
            "ocr_pages": self.ocr_pages,
            "skipped_pages": self.skipped_pages,
            "pages": [asdict(p) for p in self.pages],
        }
        return json.dumps(data, ensure_ascii=False).encode()


def clean(text: str) -> str:
    """Normalise one page: NFC, comma-below ș/ț, joined hyphenated line breaks, tidy spacing."""
    text = unicodedata.normalize("NFC", text).translate(_CEDILLA)
    text = _CONTROL.sub("", text.replace("\r\n", "\n").replace("\r", "\n"))
    text = _HYPHEN_BREAK.sub(r"\1\2", text)
    lines = [_SPACES.sub(" ", line).strip() for line in text.split("\n")]
    return _BLANK_LINES.sub("\n\n", "\n".join(lines)).strip()


def drop_repeated_lines(pages: list[str], edge: int = 2, min_pages: int = 4) -> list[str]:
    """Remove page headers and footers: lines among the first or last `edge` lines of a page that
    repeat on at least 60% of pages (documents of `min_pages` pages or more). Lines that differ
    only in digits (page numbers) count as the same line."""
    if len(pages) < min_pages:
        return pages

    def key(line: str) -> str:
        return re.sub(r"\d+", "#", line)

    counts: Counter[str] = Counter()
    for page in pages:
        lines = page.split("\n")
        counts.update({key(x) for x in lines[:edge] + lines[-edge:] if x})
    repeated = {k for k, c in counts.items() if c >= 0.6 * len(pages)}
    out = []
    for page in pages:
        lines = page.split("\n")
        n = len(lines)
        kept = [
            x
            for i, x in enumerate(lines)
            if not ((i < edge or i >= n - edge) and key(x) in repeated)
        ]
        out.append("\n".join(kept).strip())
    return out


def _needs_ocr(page: pymupdf.Page, text: str) -> bool:
    return len(text.strip()) < MIN_TEXT_CHARS and bool(page.get_images(full=False))


def extract_pdf(
    data: bytes,
    *,
    ocr: bool = True,
    max_ocr_pages: int = MAX_OCR_PAGES,
    max_pages: int | None = None,
) -> DocumentText:
    """`max_pages` reads only the first pages (the classifier needs no more); `total_pages`
    still counts them all."""
    if b"%PDF-" not in data[:1024]:  # MuPDF would happily open HTML or images instead
        raise ExtractionError("not a PDF (no %PDF header)")
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except (pymupdf.FileDataError, RuntimeError, ValueError) as exc:
        raise ExtractionError(f"not a readable PDF: {exc}") from exc
    if doc.needs_pass:
        raise ExtractionError("encrypted PDF")
    if doc.page_count == 0:  # MuPDF "repairs" non-PDF bytes into an empty document
        raise ExtractionError("no pages")
    skipped: Counter[str] = Counter()
    raw: list[tuple[str, Method, str | None]] = []
    ocr_pages = 0
    with doc:
        total_pages = doc.page_count
        for page in (doc[i] for i in range(min(total_pages, max_pages or total_pages))):
            text = page.get_text()
            method: Method = "text"
            note = None
            if _needs_ocr(page, text):
                area = page.rect.width * page.rect.height
                if not ocr:
                    note = "scan; OCR off"
                elif area > MAX_OCR_AREA:
                    note = "drawing sheet larger than A3; not OCR'd"
                elif ocr_pages >= max_ocr_pages:
                    note = f"over {max_ocr_pages} OCR pages; not OCR'd"
                else:
                    textpage = page.get_textpage_ocr(language=OCR_LANGUAGE, dpi=OCR_DPI, full=True)
                    text = page.get_text(textpage=textpage)
                    method = "ocr"
                    ocr_pages += 1
                if note:
                    skipped[note] += 1
            text = clean(text)
            if not text and method == "text":
                method = "none"
            raw.append((text, method, note))
    texts = drop_repeated_lines([t for t, _, _ in raw])
    pages = [
        PageText(n=i, text=t, method=m if t or m == "ocr" else "none", note=note)
        for i, (t, (_, m, note)) in enumerate(zip(texts, raw, strict=True), start=1)
    ]
    return DocumentText(
        pages=pages,
        version=EXTRACTOR_VERSION,
        ocr_pages=ocr_pages,
        skipped_pages=dict(skipped),
        total_pages=total_pages,
    )


def raw_page_texts(data: bytes) -> list[str]:
    """Each page's text layer as is: no OCR, no cleaning, no header removal. For sources whose page
    edges carry content: in council minutes "cu unanimitate de voturi." often ends a page, and
    `drop_repeated_lines` would take it for a footer."""
    if b"%PDF-" not in data[:1024]:
        raise ExtractionError("not a PDF (no %PDF header)")
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except (pymupdf.FileDataError, RuntimeError, ValueError) as exc:
        raise ExtractionError(f"not a readable PDF: {exc}") from exc
    with doc:
        if doc.needs_pass:
            raise ExtractionError("encrypted PDF")
        return [doc[i].get_text() for i in range(doc.page_count)]


def text_r2_key(city: str, sha256: str, version: int = EXTRACTOR_VERSION) -> str:
    return f"text/{city}/{sha256}.v{version}.json"
