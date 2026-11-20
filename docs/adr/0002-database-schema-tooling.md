# ADR 0002: Database schema tooling

- Status: accepted
- Date: 2026-11-20
- Milestone: M1.2

## Context

PLAN §4 and §6 call for one Postgres/PostGIS schema, owned by `packages/db` and shared by the web app (TypeScript) and the pipeline (Python). It needs PostGIS geometry, a generated full-text column that ignores diacritics, trigram indexes and enums that both sides agree on.

## Decision

- **drizzle-orm 0.45 + drizzle-kit 0.31**, the stable lines. 1.0 is still a release candidate.
- **postgres.js 3.4** as the driver for migrations, seed and tests. It speaks plain TCP, so the same code runs against local Postgres and Neon. v4 is newer than drizzle-orm 0.45, so it's untested with it. The web app's runtime driver (for example Neon's serverless driver) is decided in M1.3.
- **Enums are defined once, in `packages/shared/src/enums.ts`.** `packages/db` builds every `pgEnum` from those arrays, and an integration test checks that the live database has exactly those values.
- **Migration `0000_extensions.sql` is hand-written.** It enables `postgis`, `pg_trgm` and `unaccent`, and creates `unaccent_immutable()`. It runs before the generated `0001_schema.sql` because the generated `project.search` column calls that function. Later migrations are generated with `pnpm db:generate`, and CI fails if the schema and the committed migrations drift apart.
- **Geometry and `tsvector` columns are small Drizzle `customType`s**, always SRID 4326. Drizzle's built-in `geometry` type only covers points.
- **`fetch` and `raw_document` are separate tables.** `fetch` is the discovery and attempt log; `raw_document` is the immutable content, unique per SHA-256. PLAN §6 lists them together.
- **Local development uses `imresamu/postgis:16-3.5`** (`docker-compose.yml`), and CI uses the same image as a service container. The official `postgis/postgis` image has no arm64 build.
- **The seed** reads `config/jurisdictions/*.yaml` and writes 10 `demo-` projects per jurisdiction. It refuses to write to a non-local host unless `--allow-remote` is passed.

## Consequences

- To add an enum value, append it in `packages/shared`, then run `pnpm db:generate`. Values can't be reordered or removed without a table rewrite.
- The Python pipeline will read and write these tables directly (SQLAlchemy Core or psycopg). Its enum definitions must be generated from or checked against `packages/shared`; that is decided when the pipeline first writes (M2.2).
