import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, jurisdictionId } from "./columns.ts";
import { jurisdiction, source } from "./core.ts";
import { fetchStatus, pipelineRunStatus } from "./enums.ts";

/**
 * One row per discovered URL per attempt (PLAN §7 stages 1–2). Discover inserts `pending`
 * rows; fetch fills in the HTTP result and points at the content it got.
 */
export const fetch = pgTable(
  "fetch",
  {
    id: id(),
    jurisdictionId: jurisdictionId(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => source.id),
    url: text("url").notNull(),
    status: fetchStatus("status").notNull().default("pending"),
    /** What the adapter saw on the listing page: doc_type, project title, dates. */
    hints: jsonb("hints").notNull().default({}),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    httpStatus: integer("http_status"),
    etag: text("etag"),
    lastModified: text("last_modified"),
    rawDocumentId: uuid("raw_document_id").references(() => rawDocument.id),
    error: text("error"),
  },
  (t) => [
    index("fetch_source_status_idx").on(t.sourceId, t.status),
    index("fetch_url_idx").on(t.url),
    // A URL is queued at most once per source; re-running discover is a no-op (M2.2).
    uniqueIndex("fetch_pending_url_uq")
      .on(t.sourceId, t.url)
      .where(sql`${t.status} = 'pending'`),
  ],
);

/**
 * Immutable content snapshot, unique by SHA-256. A changed file at the same URL is a new row.
 * Full bytes and text live in R2; Postgres keeps only the head of the text for search.
 */
export const rawDocument = pgTable(
  "raw_document",
  {
    id: id(),
    jurisdictionId: jurisdictionId(),
    url: text("url").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    mime: text("mime").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    pageCount: integer("page_count"),
    /** Null when the file isn't mirrored (too large, personal data, or copyright; PLAN §5, §11). */
    r2Key: text("r2_key"),
    textR2Key: text("text_r2_key"),
    /** First ~8 KB of extracted text plus headings. */
    textHead: text("text_head"),
    ocrUsed: boolean("ocr_used").notNull().default(false),
    /** Classifier output (PLAN §7 stage 4). */
    docType: text("doc_type"),
    /** Set by the PII detector before mirroring; null means not checked yet. */
    containsPersonalData: boolean("contains_personal_data"),
    /** Recovered from the Wayback Machine rather than the live site (PLAN §10). */
    isArchivedCopy: boolean("is_archived_copy").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.jurisdictionId, t.sha256), index("raw_document_url_idx").on(t.url)],
);

/** Provenance and cache for every LLM call (PLAN §7 "LLM cost control"). */
export const extractionRun = pgTable(
  "extraction_run",
  {
    id: id(),
    jurisdictionId: jurisdictionId(),
    rawDocumentId: uuid("raw_document_id")
      .notNull()
      .references(() => rawDocument.id),
    /** "classify", "extract_fields" or "summarise". */
    task: text("task").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    inputHash: char("input_hash", { length: 64 }).notNull(),
    output: jsonb("output").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("extraction_run_cache_key").on(t.inputHash, t.promptVersion, t.model),
    index("extraction_run_document_idx").on(t.rawDocumentId),
  ],
);

/** One row per stage run per adapter, for the source-health dashboard (PLAN §4). */
export const pipelineRun = pgTable(
  "pipeline_run",
  {
    id: id(),
    jurisdictionId: integer("jurisdiction_id").references(() => jurisdiction.id),
    adapter: text("adapter"),
    stage: text("stage").notNull(),
    status: pipelineRunStatus("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    stats: jsonb("stats").notNull().default({}),
    error: text("error"),
  },
  (t) => [index("pipeline_run_started_idx").on(t.startedAt)],
);
