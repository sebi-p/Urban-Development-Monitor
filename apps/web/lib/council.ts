import type { CouncilItem, ProjectDocumentLink } from "@mdu/db";

/**
 * The council item a project's facts summary describes: the latest with an outcome, or else the
 * latest one on an agenda. Null when the council never had the project.
 */
export function councilDecision(items: CouncilItem[]): CouncilItem | null {
  const decided = items.filter((i) => i.outcome !== null);
  return decided.at(-1) ?? items.at(-1) ?? null;
}

export type VotePart = "for" | "against" | "abstain" | "absent";

/** The counts worth saying, in the order the minutes give them; zeros after "for" are left out. */
export function voteParts(votes: CouncilItem["votes"]): { part: VotePart; n: number }[] {
  if (votes.unanimous || votes.for === null) return [];
  const parts: { part: VotePart; n: number }[] = [{ part: "for", n: votes.for }];
  for (const part of ["against", "abstain", "absent"] as const) {
    const n = votes[part];
    if (n) parts.push({ part, n });
  }
  return parts;
}

/** The minutes link at the page that records the item (the agenda when there are no minutes). */
export function councilSource(item: CouncilItem): string | null {
  if (item.minutesUrl) return item.page ? `${item.minutesUrl}#page=${item.page}` : item.minutesUrl;
  return item.agendaUrl;
}

/**
 * The sessions' agendas and minutes as document links, after the project's own files and never
 * repeating one. `label` names each file (already translated).
 */
export function withCouncilFiles(
  documents: ProjectDocumentLink[],
  items: CouncilItem[],
  label: (file: "agenda" | "minutes", item: CouncilItem) => string,
): ProjectDocumentLink[] {
  const out = [...documents];
  const seen = new Set(out.map((d) => d.url.split("#")[0]));
  const add = (url: string | null, file: "agenda" | "minutes", item: CouncilItem) => {
    if (!url) return;
    const key = url.split("#")[0]!;
    if (seen.has(key)) return;
    seen.add(key);
    const href = file === "minutes" && item.page ? `${url}#page=${item.page}` : url;
    out.push({ label: label(file, item), url: href, size_bytes: null, date: item.sessionDate });
  };
  for (const item of items) {
    add(item.agendaUrl, "agenda", item);
    add(item.minutesUrl, "minutes", item);
  }
  return out;
}
