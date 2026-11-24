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
    // A form without JavaScript sends one value per checked box.
    expect(parseFilters(new URLSearchParams("tip=pud&tip=puz")).kinds).toEqual(["puz", "pud"]);
  });

  it("keeps a neighbourhood and a drawn area in a readable link", () => {
    const f = parseFilters(
      new URLSearchParams("cartier=valea-cetatii&zona=25.6,45.6;25.7,45.6;25.651234567,45.7"),
    );
    expect(f.neighbourhood).toBe("valea-cetatii");
    expect(f.area).toEqual([
      [25.6, 45.6],
      [25.7, 45.6],
      [25.651234567, 45.7],
    ]);
    expect(toQuery(f)).toBe("cartier=valea-cetatii&zona=25.6,45.6;25.7,45.6;25.65123,45.7");
    expect(toDbFilters(f)).toMatchObject({ neighbourhoods: ["valea-cetatii"] });
    // Two corners, a corner off the globe, or junk: no area, the rest of the link still works.
    for (const zona of ["25.6,45.6;25.7,45.6", "25,45;200,45;25,46", "x", "1,2,3;4,5;6,7"]) {
      expect(parseFilters({ zona }).area).toBeUndefined();
    }
    expect(parseFilters({ cartier: "<script>" }).neighbourhood).toBeUndefined();
  });
});
