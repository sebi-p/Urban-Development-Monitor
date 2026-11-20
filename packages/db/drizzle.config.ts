import { defineConfig } from "drizzle-kit";
import { loadEnv } from "./src/env.ts";

loadEnv();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  // `generate` and `check` work offline; `studio` and `push` need DATABASE_URL.
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  // PostGIS owns these; never diff or drop them.
  extensionsFilters: ["postgis"],
  strict: true,
  verbose: true,
});
