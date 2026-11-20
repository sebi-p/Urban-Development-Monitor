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

TS (repo root): `pnpm install`, `pnpm dev`, `pnpm test` (Vitest), `pnpm lint`, `pnpm typecheck`, `pnpm format` / `pnpm format:check`, `pnpm build`. Playwright arrives in M4.1.

DB (repo root, `cp .env.example .env` first): `pnpm db:up` (local PostGIS in Docker), `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:generate` (after any schema change), `pnpm db:studio`. DB integration tests run when `TEST_DATABASE_URL` is set.

Python (run inside `pipeline/`): `uv sync`, `uv run pytest`, `uv run ruff check .`, `uv run ruff format .`, `uv run mypy`, `uv run mdu ingest --adapter brasov.council_debates --dry-run`. Code lives in `pipeline/src/mdu/` (`mdu.core`, `mdu.adapters.<city>`), see ADR 0001.

Deploy (ADR 0003): one environment. Every push to `main` deploys to production on Vercel, which runs `vercel-build` (`db:deploy` = migrate, then seed the [DEMO] projects unless `MDU_DEMO_DATA=off`; then `next build`). Run every check locally before pushing: there is no staging.

CI (`.github/workflows/ci.yml`) runs every check above. Run them before you commit.

## Rules

- Never fetch live municipal URLs in tests; add a fixture instead (`uv run mdu fixtures capture|push|pull`). Live access goes only through `pipeline/src/mdu/core/http.py` (robots.txt, throttle, User-Agent).
- Never commit raw HTML/PDFs or source URLs: they live in private R2 (ADR 0004). Commit only processed output, checked for personal data. Source notes: `docs/sources/brasov.md`.
- Change the schema only through Drizzle migrations, and update the `packages/shared` enums in the same PR. Enum values live only in `packages/shared/src/enums.ts`; append, never reorder.
- No Brașov-specific strings outside `pipeline/src/mdu/adapters/brasov/` and `config/jurisdictions/brasov.yaml`.
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
