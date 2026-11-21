// Domain enums (PLAN §6). The single source of truth: packages/db builds its Postgres enums from these
// arrays, so adding a value here plus `pnpm db:generate` is the whole change.
// Append new values at the end; Postgres can't reorder or drop enum values without a rewrite.

export const PROJECT_KINDS = [
  "pug",
  "puz",
  "pud",
  "cu", // certificat de urbanism
  "ac", // autorizație de construire
  "ad", // autorizație de desființare (demolition)
  "certificate_of_completion",
  "public_infrastructure",
  "regulation",
  "other_council_decision",
] as const;

export const PROJECT_STATUSES = [
  "announced",
  "in_preparation",
  "in_public_consultation",
  "under_committee_review",
  "on_council_agenda",
  "approved",
  "rejected",
  "withdrawn",
  "permitted",
  "under_construction",
  "completed",
  "contested",
  "annulled",
  "expired",
] as const;

export const GEOM_PRECISIONS = ["parcel", "address", "street", "neighbourhood", "manual"] as const;

export const EVENT_TYPES = [
  "announced",
  "notice_published",
  "committee_review",
  "consultation_opened",
  "consultation_closed",
  "consultation_report",
  "council_agenda",
  "council_vote",
  "decision_adopted",
  "certificate_issued",
  "permit_issued",
  "construction_started",
  "completed",
  "court_ruling",
  "document_added",
  "other",
] as const;

export const IDENTIFIER_SCHEMES = ["cu", "ac", "hcl", "cf", "nr_cadastral", "puz_code"] as const;

export const DOCUMENT_ROLES = [
  "memoriu",
  "rlu",
  "plansa_reglementari",
  "raport_specialitate",
  "proiect_hcl",
  "hcl",
  "aviz",
  "raport_consultare",
  "other",
] as const;

export const REVIEW_STATES = ["auto_published", "pending_review", "approved", "rejected"] as const;

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;

export const AGENDA_OUTCOMES = ["adopted", "rejected", "withdrawn", "postponed"] as const;

export const FETCH_STATUSES = ["pending", "fetched", "unchanged", "failed", "skipped"] as const;

export const CORRECTION_STATES = ["open", "accepted", "rejected"] as const;

/** Pre-CATUC procedures (Law 50/1991, Law 350/2001) vs. Law 169/2026 (CATUC, from 2026-08-25). */
export const LEGAL_REGIMES = ["pre_catuc", "catuc"] as const;

export const PIPELINE_RUN_STATUSES = [
  "running",
  "succeeded",
  "failed",
  "budget_exhausted",
] as const;

export type ProjectKind = (typeof PROJECT_KINDS)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type GeomPrecision = (typeof GEOM_PRECISIONS)[number];
export type EventType = (typeof EVENT_TYPES)[number];
export type IdentifierScheme = (typeof IDENTIFIER_SCHEMES)[number];
export type DocumentRole = (typeof DOCUMENT_ROLES)[number];
export type ReviewState = (typeof REVIEW_STATES)[number];
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];
export type AgendaOutcome = (typeof AGENDA_OUTCOMES)[number];
export type FetchStatus = (typeof FETCH_STATUSES)[number];
export type CorrectionState = (typeof CORRECTION_STATES)[number];
export type LegalRegime = (typeof LEGAL_REGIMES)[number];
export type PipelineRunStatus = (typeof PIPELINE_RUN_STATUSES)[number];
