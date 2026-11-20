/**
 * Vercel build step (`pnpm db:deploy`): apply pending migrations, then seed demo data on preview
 * deployments only. The Neon–Vercel integration gives each preview its own Neon branch, so the
 * seed never touches production. Production applies migrations on every deploy (ADR 0003).
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

if (env === "preview") {
  const { db, client } = createDb(url, { max: 1, onnotice: () => {} });
  try {
    await seed(db);
  } finally {
    await client.end();
  }
} else {
  console.log("db:deploy: not a preview, demo seed skipped");
}
