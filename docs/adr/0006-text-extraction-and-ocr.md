# ADR 0006: Text extraction with PyMuPDF and Tesseract OCR

- Status: accepted
- Date: 2026-11-21
- Milestone: M2.3

## Context

PLAN §7 stage 3 turns stored documents into text, with OCR for scans (`ocrmypdf -l ron` in the plan). Most Brașov PDFs have a text layer, but some committee decisions are scans with no text at all. Later stages cite the page every value came from, so text must be kept page by page. Neon Free has 1 GB, so full text goes to R2.

## Decision

- **PyMuPDF 1.28** (`pymupdf>=1.28.2,<2`, AGPL-3.0, approved by the maintainer in M0) reads each page's text layer. The 2.x line was not taken: it adds onnxruntime, numpy and networkx (about 110 MB) for layout analysis that plain text extraction doesn't need.
- **OCR uses PyMuPDF's built-in Tesseract call** (`Page.get_textpage_ocr`, language `ron`, 300 dpi) instead of `ocrmypdf`. Same OCR engine, but no Ghostscript (AGPL) and no step to split the output back into pages. A page is OCR'd when it has fewer than 100 characters of text and at least one image. Pages larger than A3 (plan sheets) and pages beyond 80 per document are not OCR'd; the page records why.
- **Tesseract 5 with Romanian data** is a system dependency: `brew install tesseract tesseract-lang` locally, the `tesseract-ocr` and `tesseract-ocr-ron` apt packages in CI. OCR tests fail in CI if it's missing and skip locally.
- **Clean-up:** NFC; the old cedilla letters ş/ţ become ș/ț; hyphenated line breaks are joined; header and footer lines repeated on at least 60% of pages are dropped (page numbers ignored).
- **Storage:** one JSON file per document at `text/<city>/<sha256>.v<version>.json` in private R2, with an entry per page (number, text, `text`/`ocr`/`none`, note). `raw_document` gets `text_r2_key`, `text_head` (first 8,000 characters, for the classifier), `page_count` and `ocr_used`. No schema change.
- **Idempotent and versioned:** the stage picks PDFs whose `text_r2_key` doesn't name the current `EXTRACTOR_VERSION`. Re-running does nothing; bumping the version reprocesses everything. Unreadable files get a JSON file holding the error, so they aren't retried until the version changes.

## Consequences

- Extraction reads only R2 and sends no requests to the source sites, so it can run at any time.
- Extracted text can contain personal data. It stays in private R2 and in `raw_document.text_head`, which the web app never reads (PLAN §11).
- OCR quality depends on the scans. Text from scans is marked per page, so later stages can treat it with lower confidence.
