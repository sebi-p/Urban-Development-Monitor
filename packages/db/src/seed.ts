/**
 * Dev/preview seed: upserts every jurisdiction in config/jurisdictions/*.yaml and gives each one
 * 10 fake projects at random points inside its bbox. Fake rows use `demo-` slugs and "[DEMO]"
 * titles; re-running replaces them, so the result is always the same 10.
 */
import type { EventType, ProjectKind, ProjectStatus } from "@mdu/shared";
import { and, eq, like, sql } from "drizzle-orm";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { createDb, type Db } from "./client.ts";
import { databaseUrl } from "./env.ts";
import { consultation, identifier, jurisdiction, project, projectEvent } from "./schema/index.ts";

export const DEMO_PROJECTS_PER_JURISDICTION = 10;

const CONFIG_DIR = fileURLToPath(new URL("../../../config/jurisdictions", import.meta.url));

interface JurisdictionFile {
  slug: string;
  name: string;
  county: string;
  country?: string;
  timezone?: string;
  bbox: [number, number, number, number];
  config?: Record<string, unknown>;
}

export function loadJurisdictionFiles(dir = CONFIG_DIR): JurisdictionFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => parse(readFileSync(`${dir}/${f}`, "utf8")) as JurisdictionFile);
}

/** Small deterministic PRNG so every seed run produces the same points (mulberry32). */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Generic Romanian street names found in most towns; nothing city-specific.
const STREETS = [
  "Grădinii",
  "Morii",
  "Livezii",
  "Fântânii",
  "Teilor",
  "Pădurii",
  "Viilor",
  "Florilor",
  "Câmpului",
  "Școlii",
];

const SAMPLES: { kind: ProjectKind; status: ProjectStatus; what: string; event: EventType }[] = [
  {
    kind: "puz",
    status: "in_public_consultation",
    what: "PUZ locuințe colective",
    event: "consultation_opened",
  },
  { kind: "pud", status: "announced", what: "PUD clădire de birouri", event: "notice_published" },
  {
    kind: "puz",
    status: "on_council_agenda",
    what: "PUZ zonă mixtă comerț și servicii",
    event: "council_agenda",
  },
  {
    kind: "pud",
    status: "approved",
    what: "PUD locuință unifamilială P+1",
    event: "decision_adopted",
  },
  {
    kind: "puz",
    status: "under_committee_review",
    what: "PUZ ansamblu rezidențial",
    event: "committee_review",
  },
  {
    kind: "public_infrastructure",
    status: "under_construction",
    what: "Modernizare stradă și trotuare",
    event: "construction_started",
  },
  { kind: "puz", status: "rejected", what: "PUZ hotel P+6", event: "council_vote" },
  { kind: "pud", status: "withdrawn", what: "PUD extindere clădire comercială", event: "other" },
  {
    kind: "regulation",
    status: "in_preparation",
    what: "Regulament local de publicitate",
    event: "announced",
  },
  { kind: "puz", status: "completed", what: "PUZ parc și locuri de joacă", event: "completed" },
];

export async function seed(db: Db, files = loadJurisdictionFiles()): Promise<void> {
  for (const file of files) {
    const [minLon, minLat, maxLon, maxLat] = file.bbox;
    const bboxWkt = `POLYGON((${minLon} ${minLat},${maxLon} ${minLat},${maxLon} ${maxLat},${minLon} ${maxLat},${minLon} ${minLat}))`;
    const values = {
      slug: file.slug,
      name: file.name,
      county: file.county,
      country: file.country ?? "RO",
      timezone: file.timezone ?? "Europe/Bucharest",
      bbox: sql`ST_GeomFromText(${bboxWkt}, 4326)`,
      config: file.config ?? {},
    };
    const [j] = await db
      .insert(jurisdiction)
      .values(values)
      .onConflictDoUpdate({ target: jurisdiction.slug, set: values })
      .returning({ id: jurisdiction.id });
    if (!j) throw new Error(`could not upsert jurisdiction ${file.slug}`);

    await db.transaction(async (tx) => {
      // Children cascade; only demo rows are touched.
      await tx
        .delete(project)
        .where(and(eq(project.jurisdictionId, j.id), like(project.slug, "demo-%")));

      const random = rng(j.id);
      for (const [i, sample] of SAMPLES.slice(0, DEMO_PROJECTS_PER_JURISDICTION).entries()) {
        const lon = minLon + random() * (maxLon - minLon);
        const lat = minLat + random() * (maxLat - minLat);
        const street = STREETS[i % STREETS.length];
        const n = i + 1;
        const [p] = await tx
          .insert(project)
          .values({
            jurisdictionId: j.id,
            slug: `demo-${n}`,
            kind: sample.kind,
            status: sample.status,
            title: `[DEMO] ${sample.what}, str. ${street} nr. ${n * 3}`,
            addressText: `str. ${street} nr. ${n * 3}`,
            geom: sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)`,
            geomPrecision: "address",
            initiator: "SC Exemplu Dezvoltare SRL",
            summaryRo: `Proiect fictiv pentru dezvoltare: ${sample.what.toLowerCase()} pe str. ${street}.`,
            summaryEn: "Fictional project used for development and previews.",
            legalRegime: "pre_catuc",
            reviewState: "auto_published",
          })
          .returning({ id: project.id });
        if (!p) throw new Error("project insert returned nothing");

        await tx.insert(projectEvent).values({
          jurisdictionId: j.id,
          projectId: p.id,
          eventDate: `2026-${String((i % 9) + 1).padStart(2, "0")}-15`,
          eventType: sample.event,
          title: `[DEMO] ${sample.event.replaceAll("_", " ")}`,
          confidence: "high",
          reviewState: "auto_published",
        });
        await tx.insert(identifier).values({
          jurisdictionId: j.id,
          projectId: p.id,
          scheme: "puz_code",
          value: `DEMO-${n}`,
        });
        if (sample.status === "in_public_consultation") {
          await tx.insert(consultation).values({
            jurisdictionId: j.id,
            projectId: p.id,
            opensOn: "2026-11-10",
            closesOn: "2026-12-10",
            submitInstructions: "[DEMO] Observațiile se trimit în scris la registratura primăriei.",
          });
        }
      }
    });
    console.log(`seeded ${file.slug}: ${DEMO_PROJECTS_PER_JURISDICTION} demo projects`);
  }
}

if (import.meta.main) {
  const url = databaseUrl();
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1"].includes(host) && !process.argv.includes("--allow-remote")) {
    console.error(
      `Refusing to seed remote database ${host}. Pass --allow-remote for a preview branch.`,
    );
    process.exit(1);
  }
  const { db, client } = createDb(url, { max: 1 });
  try {
    await seed(db);
  } finally {
    await client.end();
  }
}
