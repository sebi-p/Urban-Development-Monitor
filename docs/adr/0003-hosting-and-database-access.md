# ADR 0003: Hosting, preview databases and database access from the web app

- Status: accepted
- Date: 2026-11-20
- Milestone: M1.3

## Context

PLAN §5 hosts the web app on Vercel Hobby and the database on Neon Free, with a Neon branch for every preview deployment. The web app reads Postgres; only the pipeline writes (PLAN §3).

## Decision

- **Neon-Managed Vercel integration** (Connectable Account) on Neon project `wild-glade-84619873` (aws-eu-central-1, Postgres 18). Production uses the Neon branch `production`. Each Git branch with a preview deployment gets a `preview/<git-branch>` Neon branch, copied from `production`, with its own `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`. Neon deletes those branches when the Git branch is deleted. There is no `vercel-dev` branch; local development uses Docker.
- **Migrations run in the Vercel build.** `apps/web`'s `vercel-build` script runs `pnpm --filter @mdu/db db:deploy` before `next build`. `db:deploy` applies pending migrations over the unpooled URL on every deployment, production included, and seeds the 10 demo projects only when `VERCEL_ENV=preview`. A Vercel build with no database URL fails instead of silently skipping. CI runs `pnpm build`, which needs no database.
- **The web app uses postgres.js through Drizzle**, not Neon's serverless HTTP driver. It connects with the pooled URL, one connection per server instance, and `prepare: false`, which is safe behind Neon's PgBouncer pooler. The same code runs against local Docker Postgres and Neon. The serverless driver can be adopted later if connection setup time becomes a problem.
- **Pages that read the database are rendered per request** (`force-dynamic`), so builds never need database access. The GeoJSON API sends `s-maxage=300, stale-while-revalidate=3600` so the CDN absorbs traffic and Neon can scale to zero (PLAN §5).
- **The MapLibre web worker is served from `public/maplibre/`.** A build step copies it from `node_modules`, and the copy is gitignored. MapLibre 6 locates its worker relative to its own module URL, which is wrong once Turbopack has bundled it.
- **Cloudflare R2** credentials are stored as GitHub Actions secrets (`R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). They're checked by the manually triggered `r2-check` workflow, which uses the AWS CLI already on GitHub's runners. No R2 code exists until M2.2.

## Consequences

- A migration that fails stops the deployment before the new code goes live. Migrations must stay backward-compatible with the running code, because the database changes before the new code is served.
- Each active preview branch uses one of Neon Free's concurrently active computes. Deleting merged Git branches keeps the count down.
- Vercel previews require a Vercel login. Automated checks send the `VERCEL_AUTOMATION_BYPASS_SECRET` as the `x-vercel-protection-bypass` header.
