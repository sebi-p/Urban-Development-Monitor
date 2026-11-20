# Monitor Dezvoltare Urbană

A batch pipeline (Python) writes and a Next.js site reads, with Postgres/PostGIS as the only contract between them. It launches for Brașov, but the core works for any city. Full plan: `docs/PLAN.md`. Work one milestone (§12) per session/PR.

## Layout

```text
apps/web/                  Next.js App Router (map, project pages, archive, admin, API)
packages/db/               Drizzle schema, migrations, seed, SQL functions
packages/shared/           enums, zod schemas, i18n keys shared with the web
pipeline/                  Python 3.12 (uv)
  core/                    http client, storage, stages, llm client, geocoder
  adapters/<city>/         one module per source (SourceAdapter protocol, PLAN §7)
  prompts/                 versioned prompt + JSON schema files
  tests/fixtures/<city>/   saved HTML/PDF + golden JSON
config/jurisdictions/      one YAML per city (brasov.yaml)
docs/adr/                  one ADR per architecture choice
docs/sources/<city>.md     URL patterns, quirks, sample files per source
.github/workflows/         ci, ingest-daily, ingest-weekly, backfill, live-smoke
```

## Commands

- `pnpm dev` runs the web app locally
- `pnpm test` runs Vitest + Playwright
- `pnpm db:migrate` applies the Drizzle migrations
- `uv run pytest` runs the pipeline tests (fixtures only)
- `uv run mdu ingest --adapter brasov.council_debates --dry-run` runs one adapter without writing

## Rules

- Never fetch live municipal URLs in tests; add a fixture instead. Live access goes only through `pipeline/core/http.py` (robots.txt, throttle, User-Agent).
- Change the schema only through Drizzle migrations, and update the `packages/shared` enums in the same PR.
- No Brașov-specific strings outside `pipeline/adapters/brasov/` and `config/jurisdictions/brasov.yaml`.
- Every extracted value keeps its `source_document_id` and page number.
- UI strings go only through `next-intl` message files (`ro` default, `en`).
- Write an ADR in `docs/adr/` for any new dependency or service.
- Ask for a plan before writing code on anything that touches the schema.
- The web app is read-only against Postgres; only the pipeline writes.
- Pipeline stages must be idempotent: re-running a stage is a no-op.
- Cache every LLM call in `extraction_run` by `(input_hash, prompt_version, model)`.
- Never scrape `extranet.brasovcity.ro` (its robots.txt disallows it).
- GDPR: show names of companies and public bodies only; store private individuals as "persoană fizică".
- Keep full document text in R2, not Postgres (Neon Free has 1 GB).
- Use TypeScript strict, ESLint, Prettier on the TS side; Ruff and mypy on the Python side.
