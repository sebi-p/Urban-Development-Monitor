import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, jurisdictionId } from "./columns.ts";
import { jurisdiction } from "./core.ts";
import { auditField, auditVerdict, correctionState } from "./enums.ts";
import { project } from "./projects.ts";

/** Public "report an error" submissions (v2). */
export const correction = pgTable(
  "correction",
  {
    id: id(),
    jurisdictionId: jurisdictionId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    proposedValue: text("proposed_value").notNull(),
    evidenceUrl: text("evidence_url"),
    /** Optional and personal data: never shown publicly. */
    contact: text("contact"),
    state: correctionState("state").notNull().default("open"),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("correction_state_idx").on(t.jurisdictionId, t.state)],
);

/** Every human edit. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    jurisdictionId: integer("jurisdiction_id").references(() => jurisdiction.id),
    /** GitHub login of the maintainer. */
    actor: text("actor").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entity, t.entityId)],
);

/**
 * Accuracy audits (M5.2, PLAN §10.7): a random sample of published projects, each checked by hand
 * against its source documents. Published results appear on /metodologie.
 */
export const audit = pgTable("audit", {
  id: id(),
  jurisdictionId: jurisdictionId(),
  /** Seeds the sample, so the same audit can be redrawn. */
  seed: integer("seed").notNull(),
  sampleSize: integer("sample_size").notNull(),
  /** GitHub login of the reviewer who started it. */
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

/** One sampled project, with the values as shown when the sample was drawn. */
export const auditItem = pgTable(
  "audit_item",
  {
    id: id(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audit.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    /** 1-based place in the sample. */
    position: integer("position").notNull(),
    /** Title, status, location, figures, summary and consultation as displayed, with sources. */
    snapshot: jsonb("snapshot").notNull(),
  },
  (t) => [unique().on(t.auditId, t.position), unique().on(t.auditId, t.projectId)],
);

/** A verdict on one value of a sampled project; `key` names the figure for `figure` checks. */
export const auditCheck = pgTable(
  "audit_check",
  {
    id: id(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => auditItem.id, { onDelete: "cascade" }),
    field: auditField("field").notNull(),
    key: text("key").notNull().default(""),
    verdict: auditVerdict("verdict").notNull(),
    note: text("note"),
    checkedBy: text("checked_by").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.itemId, t.field, t.key)],
);
