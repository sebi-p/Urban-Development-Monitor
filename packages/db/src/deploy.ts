/**
 * Vercel build step (`pnpm db:deploy`): apply pending migrations and upsert the jurisdictions from
 * config/jurisdictions/*.yaml. Real data now comes from the pipeline, so the [DEMO] projects are
 * deleted on every deploy; set MDU_DEMO_DATA=on to seed them instead (ADR 0003).
 */
import { createDb } from "./client.ts";
import { runMigrations } from "./migrate.ts";
import { removeDemoProjects, seed, upsertJurisdictions } from "./seed.ts";

const env = process.env.VERCEL_ENV; // "production" | "preview" | "development" | undefined
// Migrations need a direct connection; the pooled URL is for app traffic.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!url) {
  if (env) {
    console.error(
      `db:deploy: no DATABASE_URL on Vercel (${env}). Is the Neon integration connected?`,
    );
    process.exit(1);
  }
  console.log("db:deploy: no DATABASE_URL, skipping (not on Vercel)");
  process.exit(0);
}

await runMigrations(url);
console.log(`db:deploy: migrations applied (${env ?? "local"})`);

const { db, client } = createDb(url, { max: 1, onnotice: () => {} });
try {
  if (process.env.MDU_DEMO_DATA === "on") {
    await seed(db);
  } else {
    const ids = await upsertJurisdictions(db);
    const removed = await removeDemoProjects(db);
    console.log(
      `db:deploy: ${ids.size} jurisdiction(s) upserted, ${removed} demo project(s) removed`,
    );
  }
} finally {
  await client.end();
}
