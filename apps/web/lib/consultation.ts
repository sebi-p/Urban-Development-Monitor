import type { ConsultationItem } from "@mdu/db";

export type ConsultationState =
  | { state: "open"; closesOn: string; daysLeft: number }
  | { state: "upcoming"; opensOn: string }
  | { state: "closed"; closesOn: string }
  | { state: "unknown" };

/** Today's date in the city's time zone, as YYYY-MM-DD (consultations close on a local date). */
export function today(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Where a consultation stands on `day`: open (with the days left), upcoming or closed. */
export function consultationState(
  c: Pick<ConsultationItem, "opensOn" | "closesOn">,
  day: string,
): ConsultationState {
  if (c.opensOn && day < c.opensOn) return { state: "upcoming", opensOn: c.opensOn };
  if (c.closesOn && day > c.closesOn) return { state: "closed", closesOn: c.closesOn };
  if (c.closesOn)
    return { state: "open", closesOn: c.closesOn, daysLeft: daysBetween(day, c.closesOn) };
  return { state: "unknown" };
}

/** The consultation to show first: an open one, then the next upcoming, then the latest. */
export function mainConsultation(
  list: ConsultationItem[],
  day: string,
): { consultation: ConsultationItem; status: ConsultationState } | null {
  const rank = { open: 0, upcoming: 1, closed: 2, unknown: 3 } as const;
  const ranked = list
    .map((consultation) => ({ consultation, status: consultationState(consultation, day) }))
    .sort((a, b) => rank[a.status.state] - rank[b.status.state]);
  return ranked[0] ?? null;
}
