import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Loads the repo-root `.env` if present (never committed). Real env vars win. */
export function loadEnv(): void {
  const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

export function databaseUrl(): string {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  return url;
}
