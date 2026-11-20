import { date, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { id, jurisdictionId } from "./columns.ts";
import { rawDocument } from "./documents.ts";
import { agendaOutcome } from "./enums.ts";
import { project } from "./projects.ts";

export const councilSession = pgTable(
  "council_session",
  {
    id: id(),
    jurisdictionId: jurisdictionId(),
    sessionDate: date("session_date").notNull(),
    /** e.g. "ordinară", "extraordinară", as the source names it. */
    sessionType: text("session_type"),
    /** The source's own id for the session (e.g. the agenda page id). */
    sourceRef: text("source_ref"),
    agendaDocumentId: uuid("agenda_document_id").references(() => rawDocument.id),
    minutesDocumentId: uuid("minutes_document_id").references(() => rawDocument.id),
  },
  (t) => [
    unique().on(t.jurisdictionId, t.sourceRef),
    index("council_session_date_idx").on(t.jurisdictionId, t.sessionDate),
  ],
);

export const agendaItem = pgTable(
  "agenda_item",
  {
    id: id(),
    jurisdictionId: jurisdictionId(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => councilSession.id, { onDelete: "cascade" }),
    itemNumber: integer("item_number").notNull(),
    itemText: text("item_text").notNull(),
    projectId: uuid("project_id").references(() => project.id),
    outcome: agendaOutcome("outcome"),
    votesFor: integer("votes_for"),
    votesAgainst: integer("votes_against"),
    votesAbstain: integer("votes_abstain"),
    rawDocumentId: uuid("raw_document_id").references(() => rawDocument.id),
  },
  (t) => [unique().on(t.sessionId, t.itemNumber), index("agenda_item_project_idx").on(t.projectId)],
);
