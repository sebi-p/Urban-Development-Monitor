import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { geometry } from "./types.ts";

/** A city or municipality. Every other table carries `jurisdiction_id`; URLs are `/{slug}/...`. */
export const jurisdiction = pgTable("jurisdiction", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  county: text("county").notNull(),
  country: text("country").notNull().default("RO"),
  bbox: geometry("bbox", "Polygon"),
  timezone: text("timezone").notNull().default("Europe/Bucharest"),
  /** Neighbourhood source, street list, legal-regime mapping, impact parameters (PLAN §6, §9). */
  config: jsonb("config").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per adapter instance, e.g. `brasov.council_debates`. */
export const source = pgTable(
  "source",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jurisdictionId: integer("jurisdiction_id")
      .notNull()
      .references(() => jurisdiction.id),
    adapter: text("adapter").notNull(),
    baseUrl: text("base_url").notNull(),
    /** Cron expression, Europe/Bucharest. */
    schedule: text("schedule"),
    enabled: boolean("enabled").notNull().default(true),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.jurisdictionId, t.adapter)],
);

export const neighbourhood = pgTable(
  "neighbourhood",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jurisdictionId: integer("jurisdiction_id")
      .notNull()
      .references(() => jurisdiction.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    geom: geometry("geom", "MultiPolygon").notNull(),
    /** Where the boundary came from: "osm", "pug_unit" or "manual". */
    boundarySource: text("boundary_source").notNull(),
  },
  (t) => [
    unique().on(t.jurisdictionId, t.slug),
    index("neighbourhood_geom_idx").using("gist", t.geom),
  ],
);
