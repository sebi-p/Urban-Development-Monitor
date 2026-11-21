# ADR 0009: Field extraction with checked quotes, Claude Sonnet 5.5

- Status: accepted
- Date: 2026-11-21
- Milestone: M3.2 (and the URL-based part of M3.3's linking)

## Context

PLAN §7 stage 5 extracts identifiers by regular expression and the remaining fields with an LLM and a strict JSON schema; each value keeps the page it came from. PLAN §6 already has the columns (`project.initiator`, `designer`, `indicators` with `Sourced<T>` values, `identifier`, `project_document`), so no migration is needed. The acceptance test is 90% field accuracy on a golden set.

## Decision

- **Linking:** a stored file is attached to the project whose listing names its URL (`project_document`, role = its classified type). Registers of comments are never linked or read. Projects found only on the urbanism hub wait for the linker (M3.3).
- **Identifiers** (`mdu.core.identifiers`): CU numbers with their dates, and CF and cadastral numbers, from every page of a project's documents. A value already owned by another project is left for the linker. HCL numbers in planning documents mostly cite earlier plans, so they aren't taken from there.
- **Pages sent:**
  - first, page 1 of the technical report and of the draft decision;
  - then the pages with the most indicator keywords (POT, CUT, height, parking, green space, initiator, designer) from the technical report, memoriu and RLU;
  - up to 12,000 characters per project, each page labelled with its document and page number.
- **One call per project.** `claude-sonnet-5-5` is called at effort `low`, with server-side refusal fallback (beta `server-side-fallback-2026-07-01`, `fallbacks: "default"`). The prompt is in `pipeline/src/mdu/prompts/fields/v1.md`. The schema allows only the listed fields, each `{value, doc, page, quote}` or null. The prompt spells out:
  - proposed values, not those that apply today;
  - the main zone's values, or null when it's unclear which zone is the main one;
  - permitted maximums, not achieved ones;
  - a volumetric CUT is not CUT.
- **Every value is checked before it's stored** (`mdu.core.fields.check`). The quote must be found on the cited page (diacritics and spacing normalised), and a number must be one of the numbers in its quote. Romanian number formats are handled: `1.855,00`, `0,80`, `14 487`. Values that fail are dropped and counted.
- **Privacy (PLAN §11):** initiator and designer keep only the parts that name an organisation. "Ion Pop reprezentant X SRL" becomes "X SRL"; a private person becomes "persoană fizică" (initiator) or is dropped (designer). Quotes stay in `extraction_run` (private) and are never shown.
- **Storage and display:**
  - Indicators go into `project.indicators` with `source_document_id`, `page`, `source_url` and `confidence: "medium"`.
  - The site shows them right away, each linked to the city's PDF at that page (`#page=N`), with a note that they were extracted automatically.
  - Documents in the list show their classified type.
- **Caching and budget:** answers are cached in `extraction_run` (task `extract_fields`) by input hash, prompt version and model. A project is sent again only when its pages change. The monthly budget (`MDU_LLM_MONTHLY_USD`) is shared with the classifier.
- **Golden set:**
  - 14 projects and 58 documents, with 58 scored fields in `tests/fixtures/brasov/fields_golden.json`. These are public facts from the documents, checked for personal data.
  - A field is scored only where the proposed value is unambiguous. Values that differ by zone aren't scored yet; per-zone indicators can come later. A null means the documents don't state the value, so an invented value counts as wrong.
  - The input texts and the recorded model answers are private fixtures in R2. CI replays them and requires 90%. `uv run mdu eval fields [--model …] [--record]` runs the model live.
- **Legal basis for sending excerpts:** the documents are public on the city's website, and the purpose (public transparency about planning) matches why they were published, so the basis is legitimate interest. Anthropic processes the excerpts as a data processor. Only selected pages are sent, and names of private people are dropped before storage. The maintainer accepted this on 2026-11-21.

## Measurements (2026-11-21, golden set)

| Model               | Accuracy               | Cost (14 projects) | Kind of misses                                                   |
| ------------------- | ---------------------- | ------------------ | ---------------------------------------------------------------- |
| `claude-haiku-5-5`  | 89.7–91.4% across runs | $0.017             | Wrong values, e.g. POT 25% (achieved) instead of the 35% maximum |
| `claude-sonnet-5-5` | 91.4%                  | $0.30              | Mostly gaps; one height regime written differently               |

Sonnet was chosen because a gap is safer than a wrong value on a public site. That costs about $0.02 per project.

## Consequences

- Each project in the list shows its height regime, POT, CUT, homes and so on, each linking to its page.
- Values that differ by zone are often missing until per-zone indicators exist.
- A change to page selection or the prompt changes every input hash. The golden answers must then be re-recorded (`mdu eval fields --record`, about $0.30) and pushed with `mdu fixtures push`.
