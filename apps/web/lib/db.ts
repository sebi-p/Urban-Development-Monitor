import "server-only";
import { createDb, type Db } from "@mdu/db";

// One small pool per server instance, reused across requests and hot reloads. A few connections,
// so a page's queries run side by side (Neon's PgBouncer pooler takes many; M5.7).
const globalForDb = globalThis as { __mduDb?: Db };

export function getDb(): Db {
  if (!globalForDb.__mduDb) {
    const url = process.env.DATABASE_URL; // pooled connection on Neon
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.__mduDb = createDb(url, {
      max: 4,
      idle_timeout: 20,
      prepare: false, // safe behind Neon's PgBouncer pooler
      onnotice: () => {},
    }).db;
  }
  return globalForDb.__mduDb;
}
