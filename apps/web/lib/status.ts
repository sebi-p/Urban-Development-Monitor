import type { ProjectStatus } from "@mdu/shared";
import {
  CircleCheck,
  CircleSlash,
  FilePen,
  HardHat,
  Landmark,
  MessagesSquare,
  Scale,
  type LucideIcon,
} from "lucide-react";

/**
 * Statuses fall into seven groups, each with a colour and an icon, so status never depends on
 * colour alone (docs/design.md). The colours match `--color-status-*` in globals.css.
 */
export type StatusGroup =
  "preparation" | "consultation" | "council" | "approved" | "construction" | "closed" | "contested";

export const STATUS_GROUP: Record<ProjectStatus, StatusGroup> = {
  announced: "preparation",
  in_preparation: "preparation",
  under_committee_review: "preparation",
  in_public_consultation: "consultation",
  on_council_agenda: "council",
  expired: "council", // public debate closed; the draft goes on to the council
  approved: "approved",
  permitted: "approved",
  under_construction: "construction",
  completed: "construction",
  rejected: "closed",
  withdrawn: "closed",
  annulled: "closed",
  contested: "contested",
};

export const GROUP_COLOUR: Record<StatusGroup, string> = {
  preparation: "#7c3aed",
  consultation: "#ea580c",
  council: "#b45309",
  approved: "#15803d",
  construction: "#1d4ed8",
  closed: "#64748b",
  contested: "#be123c",
};

/** Darker shades for text on the group's tint, all at least 4.5:1 (WCAG AA, docs/design.md). */
export const GROUP_TEXT: Record<StatusGroup, string> = {
  preparation: "#6d28d9",
  consultation: "#c2410c",
  council: "#92400e",
  approved: "#166534",
  construction: "#1d4ed8",
  closed: "#475569",
  contested: "#be123c",
};

export const GROUP_ICON: Record<StatusGroup, LucideIcon> = {
  preparation: FilePen,
  consultation: MessagesSquare,
  council: Landmark,
  approved: CircleCheck,
  construction: HardHat,
  closed: CircleSlash,
  contested: Scale,
};

/** Marker colour per status, for the map. */
export const STATUS_COLOURS = Object.fromEntries(
  Object.entries(STATUS_GROUP).map(([s, g]) => [s, GROUP_COLOUR[g]]),
) as Record<ProjectStatus, string>;
