# ADR 0015: Project page, summaries, consultations and the share image

- Status: accepted
- Date: 2026-11-23
- Milestone: M4.2

## Context

PLAN §8 gives each project a page: a plain-language summary with its source, the key figures,
a consultation box, a timeline, the documents, a small map, nearby projects, JSON-LD and an Open
Graph image. In production no project had a summary and the `consultation` table was empty,
although the city's notices ("Anunț", 29 of them) state the comment period and where to send
comments.

## Decision

- **Two pipeline stages**, added to `mdu daily` after geocoding. Both use Claude Sonnet 5.5 with
  an answer schema, the `extraction_run` cache and the monthly budget, like field extraction
  (ADR 0009):
  - `consult` reads each notice linked to a project. Every value must be quoted from the cited
    page, and dates must be written in the quote. A closing date given as "within N days" must
    equal the opening date plus N. Emails at free webmail providers are dropped. One row per
    notice: migration `0006_consultation_source` adds `consultation.page`, `consultation.details`
    (quotes, model, prompt) and a unique key on (project, notice).
  - `summary` writes two or three neutral sentences in Romanian and English from the checked
    facts and selected pages. A summary is refused if it contains a number not in the input, an
    evaluative word, or two or more capitalised words that are not the title, address,
    organisations, city or a place word (it may name a person). Its source document and page are
    kept in `project.indicators.summary`; the fields stage keeps that key.
- **Golden set:** 10 notices (`consult_golden.json`, 19 values read by hand). Sonnet 5.5 scored
  100% on 2026-11-23; CI replays the recorded answers (private fixtures). About $0.011 per notice
  and $0.013 per project summary.
- **Budget:** `MDU_LLM_MONTHLY_USD` default raised from 2 to 5.
- **Page** `/{city}/proiecte/{slug}`: regenerated at most every 5 minutes (ISR). A merged
  project's slug redirects (308) to the project it joined. MapLibre loads only when the small map
  scrolls into view. `GET /api/{city}/projects/{slug}` returns the same data.
- **schema-dts** (Apache-2.0, types only, dev dependency) checks the JSON-LD at compile time:
  a `WebPage` about a `Place`, based on the documents, with breadcrumbs.
- **@fontsource/inter** (OFL-1.1) supplies Inter as `.woff` files for the share image:
  `next/og` can't read `woff2` or the `next/font` files. Latin and latin-ext are separate
  families so bold "ă" comes from the bold file. `outputFileTracingIncludes` copies the four
  files into the deployment.

## Consequences

- Consultations and summaries appear on the next daily run without manual work; a notice or
  summary that fails a check simply isn't shown (an older summary stays).
- The share preview on WhatsApp and Facebook shows the status, title and summary.
- Notices whose OCR is wrong are shown as written (the box links to the notice's page).
