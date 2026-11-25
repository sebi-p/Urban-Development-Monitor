import type { CouncilItem } from "@mdu/db";
import { describe, expect, it } from "vitest";
import { councilDecision, councilSource, voteParts, withCouncilFiles } from "./council";

const item = (over: Partial<CouncilItem> = {}): CouncilItem => ({
  sessionDate: "2026-09-25",
  itemNumber: 24,
  outcome: "adopted",
  votes: { for: 21, against: 0, abstain: 3, absent: null, unanimous: false },
  minutesUrl: "https://x.test/pv.pdf",
  page: 6,
  agendaUrl: "https://x.test/odz.pdf",
  ...over,
});

describe("council facts", () => {
  it("describes the latest decided item, or else the latest on an agenda", () => {
    const agenda = item({ sessionDate: "2026-10-30", outcome: null });
    const adopted = item();
    expect(councilDecision([adopted, agenda])).toBe(adopted);
    expect(councilDecision([agenda])).toBe(agenda);
    expect(councilDecision([])).toBeNull();
  });

  it("says the counts that matter, and none for a unanimous vote", () => {
    expect(voteParts(item().votes)).toEqual([
      { part: "for", n: 21 },
      { part: "abstain", n: 3 },
    ]);
    expect(voteParts({ ...item().votes, unanimous: true })).toEqual([]);
    expect(voteParts({ ...item().votes, for: null })).toEqual([]);
  });

  it("cites the minutes at the item's page, or the agenda", () => {
    expect(councilSource(item())).toBe("https://x.test/pv.pdf#page=6");
    expect(councilSource(item({ minutesUrl: null }))).toBe("https://x.test/odz.pdf");
  });

  it("adds each session's files once, after the project's own", () => {
    const own = { label: "01. Memoriu", url: "https://x.test/m.pdf", size_bytes: 1 };
    const files = withCouncilFiles([own], [item(), item({ itemNumber: 25 })], (f) => f);
    expect(files.map((d) => [d.label, d.url])).toEqual([
      ["01. Memoriu", "https://x.test/m.pdf"],
      ["agenda", "https://x.test/odz.pdf"],
      ["minutes", "https://x.test/pv.pdf#page=6"],
    ]);
    expect(files[2]!.date).toBe("2026-09-25");
  });
});
