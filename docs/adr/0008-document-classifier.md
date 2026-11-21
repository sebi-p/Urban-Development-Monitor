# ADR 0008: Document classifier, rules first with a Claude Haiku fallback

- Status: accepted
- Date: 2026-11-21
- Milestone: M3.1

## Context

PLAN §7 stage 4 gives every stored document a type (memoriu, regulations, drawing sheet, draft decision and so on), so later stages know which pages to read. The PLAN asks for rules first with an LLM fallback, a provider-agnostic client, and Claude Haiku as the optional paid model. The acceptance test is 95% correct on a fixture set.

## Decision

- **Types:** `DOCUMENT_ROLES` in `packages/shared` gains `anunt`, `referat_aprobare`, `plansa`, `registru_opinii`, `certificat_urbanism`, `studiu`, `ordine_zi_comisie` and `hotarari_comisie` (appended; migration 0004). `raw_document.doc_type` holds one of these for PDFs.
- **Rules first** (`mdu.core.classify`), in this order:
  1. The listing label (the link text the city gives the file).
  2. The headings on the first two pages.
  3. The page shape: one or two pages carrying a CAD stamp, or mostly numbers, is a drawing sheet.

  The names come from national planning procedure, not one city, so the rules live in the core.

- **LLM fallback** (`mdu.core.llm`):
  - **Model and inputs:** documents no rule recognises go to `claude-haiku-5-5` through the official `anthropic` SDK. It gets the listing label and the first 2,000 characters of text, at effort `low`.
  - **Output:** a JSON schema built from `DOCUMENT_ROLES` constrains it to one type and a confidence.
  - **Prompt:** versioned in `pipeline/src/mdu/prompts/classify/v1.md`.
  - **Low confidence:** a "low" answer is kept in `extraction_run` for review, but the document stays `other`.
- **Provider-agnostic:** the stage takes any object with `model`, `prompt_version` and `__call__(input) -> LlmResult`. A Gemini or local client can be added without touching the stage.
- **Caching and cost:**
  - Every rule decision and every LLM answer is logged in `extraction_run`. A rules row with the classifier version marks a document done.
  - LLM answers are cached by input hash, prompt version and model, so identical inputs are paid for once.
  - The monthly cap comes from `MDU_LLM_MONTHLY_USD` (default $2). It's checked before each call, so it can overshoot by one call.
  - A document left unanswered by an API error or the cap isn't marked done; the next run retries it.
- **Switching it on:** the LLM is used only when `ANTHROPIC_API_KEY` is set: in `.env` locally, and as a GitHub Actions secret for the daily run. Without the key, the classifier runs on rules only.
- **Test set:** 71 stored documents copied inside R2 into the private fixtures, with no new requests to the city's site. They're spread over 13 types. The committed `classify_golden.json` maps fixture IDs to types; listing labels stay in the private sidecars. Registers of comments are excluded and tested with a made-up label.

## Measurements (2026-11-21)

- **Rules alone:** 70/71 (98.6%) on the test set. The miss is a design brief that quotes "regulament local de urbanism". CI enforces at least 95% with rules only and never calls the API.
- **Claude Haiku alone,** for comparison: 69/71 (97.2%) for $0.016 (153K input and 1.7K output tokens, 109 s).
- **Caveat:** the rules were written with the test set in view, so expect lower accuracy on new wordings. Those documents go to the fallback.

## Consequences

- **Personal data:** excerpts of documents no rule recognises are sent to Anthropic's API, so Anthropic acts as a data processor for those excerpts (PLAN §11). Only the label and the first 2,000 characters are sent, and only for those documents, which is a small share.
- **New dependency:** `anthropic`, MIT-licensed, pulling in `httpx2` and `pydantic`.
