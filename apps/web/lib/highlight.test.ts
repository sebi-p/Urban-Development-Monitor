import { describe, expect, it } from "vitest";
import { archiveHref, parseArchive, toSearchParams } from "@/lib/archive";
import { highlight, searchTerms, snippet } from "@/lib/highlight";

describe("highlight", () => {
  it("marks words regardless of diacritics, case and inflection", () => {
    const parts = highlight("Locuințe colective în Răcădău", searchTerms("racadau locuinte"));
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(["Locuințe", "Răcădău"]);
    expect(parts.map((p) => p.text).join("")).toBe("Locuințe colective în Răcădău");
    expect(highlight("<b>x</b>", searchTerms("b"))).toEqual([
      { text: "<", match: false },
      { text: "b", match: true },
      { text: ">x</", match: false },
      { text: "b", match: true },
      { text: ">", match: false },
    ]); // plain text parts: React escapes them
  });

  it("cuts a long text around the first match", () => {
    const text = `${"cuvânt ".repeat(60)}Tractorul ${"altceva ".repeat(60)}`;
    const s = snippet(text, searchTerms("tractorul"), 100);
    expect(s).toContain("Tractorul");
    expect(s.startsWith("…") && s.endsWith("…")).toBe(true);
    expect(s.length).toBeLessThanOrEqual(102);
  });
});

describe("archive URL", () => {
  it("round-trips a query with repeated initiators and one year", () => {
    const a = parseArchive(
      new URLSearchParams(
        "q=racadau&tip=puz&initiator=SC+A%2C+B+SRL&initiator=SC+C+SRL&an=2024&ordine=data&pagina=2",
      ),
    );
    expect(a).toMatchObject({
      q: "racadau",
      kinds: ["puz"],
      initiators: ["SC A, B SRL", "SC C SRL"],
      from: 2024,
      to: 2024,
      sort: "date",
      page: 2,
    });
    expect(parseArchive(new URLSearchParams(archiveHref(a)))).toEqual(a);
    expect(archiveHref(a, { page: 1, sort: "relevance" })).not.toMatch(/pagina|ordine/);
    expect(toSearchParams(parseArchive({}))).toMatchObject({ sort: "date", page: 1 });
  });
});

describe("CSV", () => {
  it("quotes fields and defuses formulas", async () => {
    const { csvField } = await import("@/lib/csv");
    expect(csvField('PUZ "Lungă", nr. 5')).toBe('"PUZ ""Lungă"", nr. 5"');
    expect(csvField("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvField(null)).toBe('""');
  });
});
