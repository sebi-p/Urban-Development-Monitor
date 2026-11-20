import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.ts";

export function createDb(url: string, options: postgres.Options<Record<string, never>> = {}) {
  const client = postgres(url, { max: 5, ...options });
  return { db: drizzle(client, { schema }), client };
}

export type Db = ReturnType<typeof createDb>["db"];
