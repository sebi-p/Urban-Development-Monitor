"""Enum values the pipeline writes. The source of truth is packages/shared/src/enums.ts;
tests/test_enums.py checks that every value here exists there."""

from typing import Literal, get_args

ProjectKind = Literal["pug", "puz", "pud", "cu", "ac", "ad", "regulation", "other_council_decision"]
ProjectStatus = Literal[
    "announced",
    "in_preparation",
    "in_public_consultation",
    "on_council_agenda",
    "approved",
    "rejected",
    "withdrawn",
]
EventType = Literal["notice_published", "consultation_opened", "council_vote", "other"]
GeomPrecision = Literal["street", "address", "neighbourhood", "manual", "parcel"]
ReviewState = Literal["auto_published", "pending_review"]
Confidence = Literal["low", "medium", "high"]
LegalRegime = Literal["pre_catuc", "catuc"]
PipelineRunStatus = Literal["running", "succeeded", "failed", "budget_exhausted"]
FetchStatus = Literal["pending", "fetched", "unchanged", "failed", "skipped"]

# Python name -> TypeScript constant in packages/shared/src/enums.ts
SHARED_NAMES = {
    "PROJECT_KINDS": get_args(ProjectKind),
    "PROJECT_STATUSES": get_args(ProjectStatus),
    "EVENT_TYPES": get_args(EventType),
    "GEOM_PRECISIONS": get_args(GeomPrecision),
    "REVIEW_STATES": get_args(ReviewState),
    "CONFIDENCE_LEVELS": get_args(Confidence),
    "LEGAL_REGIMES": get_args(LegalRegime),
    "PIPELINE_RUN_STATUSES": get_args(PipelineRunStatus),
    "FETCH_STATUSES": get_args(FetchStatus),
}
