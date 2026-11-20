import { integer, timestamp, uuid } from "drizzle-orm/pg-core";
import { jurisdiction } from "./core.ts";

export const id = () => uuid("id").primaryKey().defaultRandom();

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const jurisdictionId = () =>
  integer("jurisdiction_id")
    .notNull()
    .references(() => jurisdiction.id);
