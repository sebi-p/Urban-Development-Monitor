# Monitor Dezvoltare Urbană

A batch pipeline (Python) writes and a Next.js site reads, with Postgres/PostGIS as the only contract between them. It launches for Brașov, but the core works for any city. Full plan: `docs/PLAN.md`. Work one milestone (§12) per session/PR.

## Layout

```text
apps/web/                  Next.js App Router (map, project pages, archive, admin, API)
packages/db/               Drizzle schema, migrations, seed, SQL functions
packages/shared/           enums, zod schemas, i18n keys shared with the web
pipeline/                  Python 3.12 (uv)
  src/mdu/core/            http client, storage, stages, llm client, geocoder
  src/mdu/adapters/<city>/ one module per source (SourceAdapter protocol, PLAN §7)
  src/mdu/prompts/         versioned prompt + JSON schema files
  tests/fixtures/<city>/   saved HTML/PDF + golden JSON
config/jurisdictions/      one YAML per city (brasov.yaml)
docs/adr/                  one ADR per architecture choice
docs/sources/<city>.md     URL patterns, quirks, sample files per source
.github/workflows/         ci, ingest-daily, ingest-weekly, backfill, live-smoke
```

## Commands

TS (repo root): `pnpm install`, `pnpm dev`, `pnpm test` (Vitest), `pnpm lint`, `pnpm typecheck`, `pnpm format` / `pnpm format:check`, `pnpm build`, `pnpm e2e` (Playwright browser tests on a production build with the demo data; `pnpm db:seed` first; ADR 0013).

DB (repo root, `cp .env.example .env` first): `pnpm db:up` (local PostGIS in Docker), `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:generate` (after any schema change), `pnpm db:studio`. DB integration tests run when `TEST_DATABASE_URL` is set.

Python (run inside `pipeline/`): `uv sync`, `uv run pytest`, `uv run ruff check .`, `uv run ruff format .`, `uv run mypy`, `uv run mdu ingest --adapter brasov.council_debates --dry-run`, `uv run mdu inventory --city brasov` (discover-only survey, about 25 min), `uv run mdu streets --city brasov` (street and house-number index), `DATABASE_URL=… uv run mdu ingest --adapter brasov.council_debates` (writes projects; ADR 0005), `DATABASE_URL=… uv run mdu run --stage discover|fetch --city brasov --adapter …` (queue and store documents; re-runs are no-ops), `DATABASE_URL=… uv run mdu run --stage extract --city brasov` (text per page to R2, OCR needs `brew install tesseract tesseract-lang`; ADR 0006), `DATABASE_URL=… uv run mdu run --stage classify --city brasov` (doc types: rules, then Claude Haiku if `ANTHROPIC_API_KEY` is set; ADR 0008), `… mdu run --stage fields --city brasov` (link documents, identifiers, checked project fields via Claude Sonnet; ADR 0009), `uv run mdu eval fields [--record]` (golden-set accuracy, calls the model), `… mdu run --stage link --city brasov` (merge sources, hub folders as projects, review queue; ADR 0010), `… mdu run --stage geocode --city brasov` (locations from the plans' Stereo 70 coordinates, then house numbers; ADR 0011), `DATABASE_URL=… uv run mdu daily --city brasov` (everything the `ingest-daily` workflow runs each morning; ADR 0007). Adapters are listed in `mdu.adapters.<city>.registry`. Code lives in `pipeline/src/mdu/` (`mdu.core`, `mdu.adapters.<city>`), see ADR 0001.

Deploy (ADR 0003): one environment. Every push to `main` deploys to production. After CI passes, its `migrate` job runs `pnpm db:deploy` (migrate, upsert jurisdictions, delete [DEMO] projects unless `MDU_DEMO_DATA=on`); Vercel only runs `next build` and goes live once CI and the migration pass. Run every check locally before pushing: there is no staging.

CI (`.github/workflows/ci.yml`) runs every check above. Run them before you commit.

## Rules

- Never fetch live municipal URLs in tests; add a fixture instead (`uv run mdu fixtures capture|push|pull`). Live access goes only through `pipeline/src/mdu/core/http.py` (robots.txt, throttle, User-Agent).
- Never commit raw HTML/PDFs or source URLs: they live in private R2 (ADR 0004). Commit only processed output, checked for personal data. Source notes: `docs/sources/brasov.md`.
- Change the schema only through Drizzle migrations, and update the `packages/shared` enums in the same PR. Enum values live only in `packages/shared/src/enums.ts`; append, never reorder.
- No Brașov-specific strings outside `pipeline/src/mdu/adapters/brasov/` and `config/jurisdictions/brasov.yaml`.
- Every extracted value keeps its `source_document_id` and page number.
- UI strings go only through `next-intl` message files (`ro` default, `en`). Follow `docs/design.md` (tokens in `globals.css`, components in `components/ui`, live at `/stil`).
- Write an ADR in `docs/adr/` for any new dependency or service.
- Ask for a plan before writing code on anything that touches the schema.
- The public site is read-only against Postgres. Only the pipeline writes, plus `/admin` server actions (login + allow-list, each write in `packages/db/src/admin.ts` with an `audit_log` row; ADR 0012).
- Pipeline stages must be idempotent: re-running a stage is a no-op.
- Cache every LLM call in `extraction_run` by `(input_hash, prompt_version, model)`.
- Never scrape `extranet.brasovcity.ro` (its robots.txt disallows it).
- GDPR: show names of companies and public bodies only; store private individuals as "persoană fizică".
- Keep full document text in R2, not Postgres (Neon Free has 1 GB).
- Use TypeScript strict, ESLint, Prettier on the TS side; Ruff and mypy on the Python side.
