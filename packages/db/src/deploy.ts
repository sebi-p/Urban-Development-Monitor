/**
 * Vercel build step (`pnpm db:deploy`): apply pending migrations, then seed the demo projects.
 * There is one environment: every push to `main` deploys to production and must be testable
 * live, so production gets the clearly marked [DEMO] projects until real data arrives
 * (ADR 0003). Set MDU_DEMO_DATA=off to stop seeding; the first real adapter turns it off for good.
 */
import { createDb } from "./client.ts";
import { runMigrations } from "./migrate.ts";
import { seed } from "./seed.ts";

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

if (process.env.MDU_DEMO_DATA !== "off") {
  const { db, client } = createDb(url, { max: 1, onnotice: () => {} });
  try {
    await seed(db);
  } finally {
    await client.end();
  }
} else {
  console.log("db:deploy: MDU_DEMO_DATA=off, demo seed skipped");
}
