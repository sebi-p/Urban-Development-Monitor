import type { ProjectStatus } from "@mdu/shared";

/** Marker colour per status group. Used by the map and the list legend. */
export const STATUS_COLOURS: Record<ProjectStatus, string> = {
  announced: "#7c3aed",
  in_preparation: "#7c3aed",
  under_committee_review: "#7c3aed",
  in_public_consultation: "#ea580c",
  on_council_agenda: "#ca8a04",
  expired: "#ca8a04", // public debate closed; the draft goes on to the council
  approved: "#16a34a",
  permitted: "#16a34a",
  under_construction: "#2563eb",
  completed: "#2563eb",
  rejected: "#6b7280",
  withdrawn: "#6b7280",
  annulled: "#6b7280",
  contested: "#dc2626",
};
