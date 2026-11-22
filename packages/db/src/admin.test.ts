/**
 * Admin writes (M3.5) against a real PostGIS server: every change is applied in one transaction,
 * leaves an audit_log row, and the guards refuse impossible edits.
 */
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AdminError,
  decideCandidate,
  getAdminProject,
  listReviewQueue,
  mergeProjects,
  requestRerun,
  setManualLocation,
  splitProject,
} from "./admin.ts";
import { createDb } from "./client.ts";
import { loadEnv } from "./env.ts";
import { runMigrations } from "./migrate.ts";
import { listProjects } from "./queries.ts";
import { loadJurisdictionFiles, upsertJurisdictions } from "./seed.ts";

loadEnv();
const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)("admin writes (PostGIS)", () => {
  const dbName = `mdu_admin_${randomBytes(4).toString("hex")}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let handle: ReturnType<typeof createDb>;
  let city: string;
  let jid: number;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    admin = postgres(adminUrl!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    const u = new URL(adminUrl!);
    u.pathname = `/${dbName}`;
    await runMigrations(u.toString());
    sql = postgres(u.toString(), { max: 2, onnotice: () => {} });
    handle = createDb(u.toString(), { max: 2, onnotice: () => {} });
    await upsertJurisdictions(handle.db);
    city = loadJurisdictionFiles()[0]!.slug;
    const [j] = await sql`select id from jurisdiction where slug = ${city}`;
    jid = j!.id;
  });

  afterAll(async () => {
    await handle?.client.end();
    await sql?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await sql`truncate project, link_candidate, audit_log, raw_document, extraction_run,
              project_document, "fetch", source cascade`;
    for (const slug of ["notice", "debate", "other"]) {
      const [p] = await sql`
        insert into project (jurisdiction_id, slug, kind, status, title, review_state, geom,
          geom_precision)
        values (${jid}, ${slug}, 'puz', 'approved', ${`PUZ ${slug}`}, 'auto_published',
          ST_SetSRID(ST_MakePoint(25.6, 45.65), 4326), 'street')
        returning id`;
      ids[slug] = p!.id;
    }
  });

  const audits = async () =>
    (await sql`select actor, entity, action from audit_log order by id`).map(
      (r) => `${r.actor}:${r.entity}:${r.action}`,
    );

  it("merges and splits, and a split pair is recorded as rejected", async () => {
    await mergeProjects(handle.db, { projectId: ids.notice!, intoId: ids.debate!, actor: "rev" });
    expect((await listProjects(handle.db, city))!.map((p) => p.slug).sort()).toEqual([
      "debate",
      "other",
    ]);
    expect((await getAdminProject(handle.db, ids.debate!))!.merged.map((m) => m.slug)).toEqual([
      "notice",
    ]);
    await expect(
      mergeProjects(handle.db, { projectId: ids.other!, intoId: ids.notice!, actor: "rev" }),
    ).rejects.toBeInstanceOf(AdminError); // the target is itself merged
    await splitProject(handle.db, { projectId: ids.notice!, actor: "rev" });
    const [c] =
      await sql`select state from link_candidate where subject = ${`project:${ids.notice}`}`;
    expect(c!.state).toBe("rejected");
    expect(await audits()).toEqual(["rev:project:merge", "rev:project:split"]);
  });

  it("approving a candidate merges the pair; rejecting keeps both; a decision is final", async () => {
    const [a] = await sql`
      insert into link_candidate (jurisdiction_id, subject, subject_project_id,
        candidate_project_id, score, signals)
      values (${jid}, ${`project:${ids.notice}`}, ${ids.notice!}, ${ids.debate!}, 0.7,
        '{"street": "lunga"}') returning id`;
    const [b] = await sql`
      insert into link_candidate (jurisdiction_id, subject, subject_project_id,
        candidate_project_id, score, signals)
      values (${jid}, ${`project:${ids.other}`}, ${ids.other!}, ${ids.debate!}, 0.65, '{}')
      returning id`;
    expect((await listReviewQueue(handle.db, city)).map((r) => r.score)).toEqual([0.7, 0.65]);
    await decideCandidate(handle.db, { id: a!.id, decision: "approve", actor: "rev" });
    await decideCandidate(handle.db, { id: b!.id, decision: "reject", actor: "rev" });
    const merged = await sql`select slug from project where merged_into_id is not null`;
    expect(merged.map((r) => r.slug)).toEqual(["notice"]);
    expect(await listReviewQueue(handle.db, city)).toEqual([]);
    await expect(
      decideCandidate(handle.db, { id: b!.id, decision: "approve", actor: "rev" }),
    ).rejects.toThrow(/already decided/);
  });

  it("approving a document folder attaches its files to the project", async () => {
    const [src] = await sql`
      insert into source (jurisdiction_id, adapter, base_url)
      values (${jid}, 'city.hub', 'https://x.test') returning id`;
    for (const [n, type] of [
      ["1", "memoriu"],
      ["2", "registru_opinii"],
    ] as const) {
      const [d] = await sql`
        insert into raw_document (jurisdiction_id, url, fetched_at, sha256, mime, size_bytes,
          doc_type)
        values (${jid}, ${`https://x.test/${n}.pdf`}, now(), ${n.repeat(64)}, 'application/pdf',
          1, ${type}) returning id`;
      await sql`
        insert into "fetch" (jurisdiction_id, source_id, url, status, raw_document_id, hints)
        values (${jid}, ${src!.id}, ${`https://x.test/${n}.pdf`}, 'fetched', ${d!.id},
          '{"group": "abc", "kind": "puz"}')`;
    }
    const [c] = await sql`
      insert into link_candidate (jurisdiction_id, subject, candidate_project_id, score)
      values (${jid}, 'group:city.hub:abc', ${ids.debate!}, 0.7) returning id`;
    await decideCandidate(handle.db, { id: c!.id, decision: "approve", actor: "rev" });
    const docs = await getAdminProject(handle.db, ids.debate!);
    expect(docs!.documents.map((d) => d.role)).toEqual(["memoriu"]); // never the register
  });

  it("sets a manual location inside the city and refuses one outside", async () => {
    await setManualLocation(handle.db, {
      projectId: ids.other!,
      lon: 25.61,
      lat: 45.66,
      actor: "rev",
    });
    const p = await getAdminProject(handle.db, ids.other!);
    expect([p!.lon, p!.lat, p!.precision]).toEqual([25.61, 45.66, "manual"]);
    const [loc] =
      await sql`select indicators->'location'->>'value' as v from project where id = ${ids.other!}`;
    expect(loc!.v).toBe("manual");
    await expect(
      setManualLocation(handle.db, { projectId: ids.other!, lon: 26.1, lat: 44.43, actor: "rev" }),
    ).rejects.toThrow(/outside the city/);
    const [log] = await sql`select before, after from audit_log where action = 'set_location'`;
    expect(log!.before).toMatchObject({ precision: "street" });
    expect(log!.after).toMatchObject({ precision: "manual" });
  });

  it("re-run marks make the next pipeline run redo a stage", async () => {
    const [d] = await sql`
      insert into raw_document (jurisdiction_id, url, fetched_at, sha256, mime, size_bytes,
        doc_type, text_r2_key, text_head)
      values (${jid}, 'https://x.test/m.pdf', now(), ${"9".repeat(64)}, 'application/pdf', 1,
        'memoriu', 'text/x.json', 'MEMORIU') returning id`;
    await sql`insert into project_document (jurisdiction_id, project_id, raw_document_id, role)
              values (${jid}, ${ids.debate!}, ${d!.id}, 'memoriu')`;
    for (const [task, model, hash] of [
      ["classify", "rules", "a"],
      ["extract_fields", "claude-sonnet-5-5", "b"],
    ]) {
      await sql`
        insert into extraction_run (jurisdiction_id, raw_document_id, task, model,
          prompt_version, input_hash, output)
        values (${jid}, ${d!.id}, ${task!}, ${model!}, 'v1', ${hash!.repeat(64)}, '{}')`;
    }
    await requestRerun(handle.db, { rawDocumentId: d!.id, stage: "classify", actor: "rev" });
    expect((await sql`select task from extraction_run order by task`).map((r) => r.task)).toEqual(
      [],
    );
    await requestRerun(handle.db, { rawDocumentId: d!.id, stage: "extract", actor: "rev" });
    const [doc] = await sql`select text_r2_key from raw_document where id = ${d!.id}`;
    expect(doc!.text_r2_key).toBeNull();
    expect(await audits()).toEqual([
      "rev:raw_document:rerun_classify",
      "rev:raw_document:rerun_extract",
    ]);
  });
});
