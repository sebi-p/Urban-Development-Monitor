import type { MapEntry } from "@mdu/db";
import {
  bucharestToday,
  filterEntries,
  filterOptions,
  insidePolygon,
  pins,
  shownFrom,
} from "@/lib/explore";
import { parseFilters } from "@/lib/filters";

const entry = (slug: string, extra: Partial<MapEntry> = {}): MapEntry => ({
  slug,
  title: slug,
  kind: "puz",
  status: "approved",
  address: null,
  geomPrecision: "street",
  at: [25.6, 45.65],
  date: "2025-05-01",
  years: [2025],
  neighbourhood: "centru",
  consultations: [],
  initiator: null,
  figures: {},
  ...extra,
});

const entries = [
  entry("a"),
  entry("b", { kind: "pud", status: "in_public_consultation", years: [2024, 2022] }),
  entry("c", { at: null, neighbourhood: null, years: [], date: null }),
  entry("d", { at: [25.7, 45.7], consultations: [["2026-11-20", "2026-12-10"]] }),
];
const slugs = (q: string, today = "2026-11-25") =>
  filterEntries(entries, parseFilters(new URLSearchParams(q)), today).map((e) => e.slug);

describe("filterEntries", () => {
  it("filters by kind, status, year, neighbourhood and open consultation, like the database", () => {
    expect(slugs("")).toEqual(["a", "b", "c", "d"]);
    expect(slugs("tip=pud")).toEqual(["b"]);
    expect(slugs("stare=approved")).toEqual(["a", "c", "d"]);
    expect(slugs("din=2022&pana=2023")).toEqual(["b"]);
    expect(slugs("din=2025")).toEqual(["a", "d"]);
    expect(slugs("cartier=centru")).toEqual(["a", "b", "d"]);
    expect(slugs("consultare=deschisa")).toEqual(["d"]);
    expect(slugs("consultare=deschisa", "2026-12-11")).toEqual([]);
  });

  it("keeps located projects inside a drawn area, and none without a location", () => {
    expect(slugs("zona=25.55,45.6;25.65,45.6;25.65,45.68;25.55,45.68")).toEqual(["a", "b"]);
    // A bowtie: the point sits in one of its two triangles.
    expect(slugs("zona=25.5,45.6;25.62,45.7;25.62,45.6;25.5,45.7")).toEqual(["a", "b"]);
  });
});

describe("helpers", () => {
  it("tests points against a polygon", () => {
    const square: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    expect(insidePolygon([0.5, 0.5], square)).toBe(true);
    expect(insidePolygon([1.5, 0.5], square)).toBe(false);
  });

  it("offers only the values that occur, and pins only located projects", () => {
    const options = filterOptions(entries);
    expect(options.kinds).toEqual(["puz", "pud"]);
    expect(options.statuses.sort()).toEqual(["approved", "in_public_consultation"]);
    expect(options.years).toEqual([2025, 2024, 2022]);
    expect(pins(entries).features.map((f) => f.properties.slug)).toEqual(["a", "b", "d"]);
  });

  it("reads Bucharest's date and the cards a link asks for", () => {
    expect(bucharestToday(new Date("2026-11-25T23:30:00Z"))).toBe("2026-11-26");
    expect(shownFrom("")).toBe(30);
    expect(shownFrom("60")).toBe(60);
    expect(shownFrom("99999")).toBe(2000);
    expect(shownFrom("x")).toBe(30);
  });
});
