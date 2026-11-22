import { parseFilters, toDbFilters, toQuery } from "@/lib/filters";

describe("URL filters", () => {
  it("round-trips a shared link", () => {
    const q = "tip=puz,pud&stare=approved,expired&din=2024&pana=2026&consultare=deschisa";
    const f = parseFilters(new URLSearchParams(q));
    expect(f).toEqual({
      kinds: ["puz", "pud"], // in PROJECT_KINDS order
      statuses: ["approved", "expired"],
      from: 2024,
      to: 2026,
      open: true,
    });
    expect(parseFilters(new URLSearchParams(toQuery(f)))).toEqual(f);
    expect(toDbFilters(f)).toMatchObject({ yearFrom: 2024, yearTo: 2026, openConsultation: true });
  });

  it("ignores unknown values instead of failing", () => {
    const f = parseFilters({ tip: "puz,castel", stare: "nope", din: "1800", consultare: "da" });
    expect(f).toEqual({
      kinds: ["puz"],
      statuses: [],
      from: undefined,
      to: undefined,
      open: false,
    });
    expect(toQuery(parseFilters({}))).toBe("");
  });
});
