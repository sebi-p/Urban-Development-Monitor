# ADR 0003: Hosting, preview databases and database access from the web app

- Status: accepted (amended 2026-11-20: single environment; 2026-11-21: migrations run in CI)
- Date: 2026-11-20
- Milestone: M1.3

## Context

PLAN §5 hosts the web app on Vercel Hobby and the database on Neon Free, with a Neon branch for every preview deployment. The web app reads Postgres; only the pipeline writes (PLAN §3).

## Decision

- **Neon-Managed Vercel integration** (Connectable Account) on Neon project `wild-glade-84619873` (aws-eu-central-1, Postgres 18). Production uses the Neon branch `production`. Each Git branch with a preview deployment gets a `preview/<git-branch>` Neon branch, copied from `production`, with its own `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`. Neon deletes those branches when the Git branch is deleted. There is no `vercel-dev` branch; local development uses Docker.
- **One environment.** `main` is the only long-lived branch, and every push to it deploys to production, so each deployment can be tested live. There is no staging branch.
- **Migrations run in CI, after every check passed.** The `migrate` job in `ci.yml` runs only on pushes to `main`, after the `web` and `pipeline` jobs. It runs `pnpm db:deploy` over the unpooled production URL from the `DATABASE_URL_UNPOOLED` repository secret, and fails if the secret is missing. Pushes to `main` queue rather than cancel each other, so a migration is never interrupted. Vercel only runs `next build`, which needs no database. Vercel's Deployment Checks wait for `Web (TypeScript)`, `Pipeline (Python)` and `Migrate database`, so new code goes live only after its migration. (Until 2026-11-21 the Vercel build ran the migrations, which changed the production database before CI had finished.)
- **Demo data is off.** Real data comes from the pipeline, so `db:deploy` deletes the `[DEMO]` projects on every run; `MDU_DEMO_DATA=on` seeds them instead.
- **The web app uses postgres.js through Drizzle**, not Neon's serverless HTTP driver. It connects with the pooled URL, one connection per server instance, and `prepare: false`, which is safe behind Neon's PgBouncer pooler. The same code runs against local Docker Postgres and Neon. The serverless driver can be adopted later if connection setup time becomes a problem.
- **Pages that read the database are rendered per request** (`force-dynamic`), so builds never need database access. The GeoJSON API sends `s-maxage=300, stale-while-revalidate=3600` so the CDN absorbs traffic and Neon can scale to zero (PLAN §5).
- **The MapLibre web worker is served from `public/maplibre/`.** A build step copies it from `node_modules`, and the copy is gitignored. MapLibre 6 locates its worker relative to its own module URL, which is wrong once Turbopack has bundled it.
- **Cloudflare R2** credentials are stored as GitHub Actions secrets (`R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). They're checked by the manually triggered `r2-check` workflow, which uses the AWS CLI already on GitHub's runners. No R2 code exists until M2.2.

## Consequences

- A failing check means no migration and no new code. A failing migration keeps the previous code live. Migrations must stay backward-compatible with the running code, because the database changes before the new code is served.
- With no staging, every change is checked locally (lint, typecheck, tests with PostGIS, build) before it is pushed, and CI runs again on `main`. A bad push is fixed by reverting it, which redeploys the previous state. Vercel can also roll back to an earlier deployment instantly.
- Short-lived branches still get Vercel previews and `preview/<git-branch>` Neon branches if one is ever pushed. Vercel previews require a login; automated checks send the `VERCEL_AUTOMATION_BYPASS_SECRET` as the `x-vercel-protection-bypass` header.
