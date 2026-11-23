import {
  AGENDA_OUTCOMES,
  AUDIT_FIELDS,
  AUDIT_VERDICTS,
  CONFIDENCE_LEVELS,
  CORRECTION_STATES,
  DOCUMENT_ROLES,
  EVENT_TYPES,
  FETCH_STATUSES,
  GEOM_PRECISIONS,
  IDENTIFIER_SCHEMES,
  LEGAL_REGIMES,
  PIPELINE_RUN_STATUSES,
  PROJECT_KINDS,
  PROJECT_STATUSES,
  REVIEW_STATES,
} from "@mdu/shared";
import { pgEnum } from "drizzle-orm/pg-core";

// Values come from packages/shared; never list them here.
export const projectKind = pgEnum("project_kind", PROJECT_KINDS);
export const projectStatus = pgEnum("project_status", PROJECT_STATUSES);
export const geomPrecision = pgEnum("geom_precision", GEOM_PRECISIONS);
export const eventType = pgEnum("event_type", EVENT_TYPES);
export const identifierScheme = pgEnum("identifier_scheme", IDENTIFIER_SCHEMES);
export const documentRole = pgEnum("document_role", DOCUMENT_ROLES);
export const reviewState = pgEnum("review_state", REVIEW_STATES);
export const confidence = pgEnum("confidence", CONFIDENCE_LEVELS);
export const agendaOutcome = pgEnum("agenda_outcome", AGENDA_OUTCOMES);
export const fetchStatus = pgEnum("fetch_status", FETCH_STATUSES);
export const correctionState = pgEnum("correction_state", CORRECTION_STATES);
export const legalRegime = pgEnum("legal_regime", LEGAL_REGIMES);
export const pipelineRunStatus = pgEnum("pipeline_run_status", PIPELINE_RUN_STATUSES);
export const auditField = pgEnum("audit_field", AUDIT_FIELDS);
export const auditVerdict = pgEnum("audit_verdict", AUDIT_VERDICTS);
