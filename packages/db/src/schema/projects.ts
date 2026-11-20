import type { ProjectIndicators } from "@mdu/shared";
import { sql } from "drizzle-orm";
import {
  date,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, jurisdictionId } from "./columns.ts";
import { neighbourhood } from "./core.ts";
import { rawDocument } from "./documents.ts";
import {
  confidence,
  documentRole,
  eventType,
  geomPrecision,
  identifierScheme,
  legalRegime,
  projectKind,
  projectStatus,
  reviewState,
} from "./enums.ts";
import { geometry, tsvector } from "./types.ts";

/** A real-world development that accumulates events over years (PLAN §6). */
export const project = pgTable(
  "project",
  {
    id: id(),
    jurisdictionId: jurisdictionId(),
    slug: text("slug").notNull(),
    kind: projectKind("kind").notNull(),
    status: projectStatus("status").notNull(),
    title: text("title").notNull(),
    addressText: text("address_text"),
    geom: geometry("geom"),
    geomPrecision: geomPrecision("geom_precision"),
    neighbourhoodId: uuid("neighbourhood_id").references(() => neighbourhood.id),
    /** Companies and public bodies only; private individuals are stored as "persoană fizică". */
    initiator: text("initiator"),
    designer: text("designer"),
    indicators: jsonb("indicators").$type<ProjectIndicators>().notNull().default({}),
    summaryRo: text("summary_ro"),
    summaryEn: text("summary_en"),
    legalRegime: legalRegime("legal_regime"),
    reviewState: reviewState("review_state").notNull().default("pending_review"),
    search: tsvector("search").generatedAlwaysAs(
      sql`setweight(to_tsvector('romanian', unaccent_immutable(coalesce(title, ''))), 'A') ||
          setweight(to_tsvector('romanian', unaccent_immutable(coalesce(address_text, ''))), 'B') ||
          setweight(to_tsvector('romanian', unaccent_immutable(coalesce(summary_ro, ''))), 'C')`,
    ),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.jurisdictionId, t.slug),
    index("project_geom_idx").using("gist", t.geom),
    index("project_search_idx").using("gin", t.search),
    index("project_title_trgm_idx").using("gin", t.title.op("gin_trgm_ops")),
    index("project_address_trgm_idx").using("gin", t.addressText.op("gin_trgm_ops")),
    index("project_status_idx").on(t.jurisdictionId, t.status),
  ],
);

/** Drives the project timeline. */
export const projectEvent = pgTable(
  "project_event",
  {
    id: id(),
    jurisdictionId: jurisdictionId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    eventDate: date("event_date").notNull(),
    eventType: eventType("event_type").notNull(),
    rawDocumentId: uuid("raw_document_id").references(() => rawDocument.id),
    title: text("title").notNull(),
    details: jsonb("details").notNull().default({}),
    confidence: confidence("confidence").notNull(),
    reviewState: reviewState("review_state").notNull().default("pending_review"),
    createdAt: createdAt(),
  },
  (t) => [index("project_event_project_date_idx").on(t.projectId, t.eventDate)],
);

/** Official identifiers, so the linker can join documents that never name each other. */
export const identifier = pgTable(
  "identifier",
  {
    id: id(),
    jurisdictionId: jurisdictionId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    scheme: identifierScheme("scheme").notNull(),
    value: text("value").notNull(),
    issuedOn: date("issued_on"),
    rawDocumentId: uuid("raw_document_id").references(() => rawDocument.id),
  },
  (t) => [
    unique().on(t.jurisdictionId, t.scheme, t.value),
    index("identifier_project_idx").on(t.projectId),
  ],
);

export const projectDocument = pgTable(
  "project_document",
  {
    jurisdictionId: jurisdictionId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    rawDocumentId: uuid("raw_document_id")
      .notNull()
      .references(() => rawDocument.id),
    role: documentRole("role").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.rawDocumentId, t.role] }),
    index("project_document_document_idx").on(t.rawDocumentId),
  ],
);

/** Powers the "open for comments" list. */
export const consultation = pgTable(
  "consultation",
  {
    id: id(),
    jurisdictionId: jurisdictionId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    opensOn: date("opens_on"),
    closesOn: date("closes_on"),
    submitEmail: text("submit_email"),
    submitAddress: text("submit_address"),
    submitInstructions: text("submit_instructions"),
    publicMeetingAt: timestamp("public_meeting_at", { withTimezone: true }),
    publicMeetingPlace: text("public_meeting_place"),
    rawDocumentId: uuid("raw_document_id").references(() => rawDocument.id),
  },
  (t) => [
    index("consultation_closes_idx").on(t.jurisdictionId, t.closesOn),
    index("consultation_project_idx").on(t.projectId),
  ],
);
