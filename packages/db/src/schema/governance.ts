import { bigint, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, jurisdictionId } from "./columns.ts";
import { jurisdiction } from "./core.ts";
import { correctionState } from "./enums.ts";
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
