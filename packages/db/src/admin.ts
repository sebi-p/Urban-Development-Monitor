/**
 * Admin reads and writes (M3.5, ADR 0012). The public site is read-only; these functions are
 * called only from /admin server actions after the login and allow-list check. Every write runs
 * in one transaction with an audit_log row (actor = the reviewer's GitHub login, before/after).
 */
import { sql } from "drizzle-orm";
import type { Db } from "./client.ts";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export class AdminError extends Error {}

/** A council decision from the minutes waiting to be placed on a project (M5.3). */
export interface ReviewMinutesItem {
  sessionDate: string;
  itemNumber: number;
  text: string;
  outcome: string | null;
  documentId: string | null;
  page: number | null;
}

export interface ReviewItem {
  id: string;
  subject: string;
  subjectProjectId: string | null;
  subjectTitle: string | null;
  minutes: ReviewMinutesItem | null;
  candidateProjectId: string;
  candidateSlug: string;
  candidateTitle: string;
  score: number;
  signals: Record<string, unknown>;
  state: string;
  createdAt: string;
}

/** link_candidate subject of a minutes item: "minutes:<agenda_item id>" (pipeline mdu.decisions). */
const MINUTES = "minutes:";

export async function listReviewQueue(
  db: Db,
  city: string,
  state = "pending_review",
): Promise<ReviewItem[]> {
  const rows = await db.execute<{
    id: string;
    subject: string;
    subject_project_id: string | null;
    subject_title: string | null;
    candidate_project_id: string;
    candidate_slug: string;
    candidate_title: string;
    score: string;
    signals: Record<string, unknown>;
    state: string;
    created_at: string;
    session_date: string | null;
    item_number: number | null;
    item_text: string | null;
    outcome: string | null;
    document_id: string | null;
    page: number | null;
  }>(sql`
    select lc.id, lc.subject, lc.subject_project_id, s.title as subject_title,
           lc.candidate_project_id, c.slug as candidate_slug, c.title as candidate_title,
           lc.score, lc.signals, lc.state, lc.created_at::text,
           cs.session_date::text, ai.item_number, ai.item_text, ai.outcome::text,
           ai.raw_document_id as document_id, ai.page
    from link_candidate lc
    join jurisdiction j on j.id = lc.jurisdiction_id and j.slug = ${city}
    join project c on c.id = lc.candidate_project_id
    left join project s on s.id = lc.subject_project_id
    left join agenda_item ai on lc.subject = ${MINUTES} || ai.id::text
    left join council_session cs on cs.id = ai.session_id
    where lc.state = ${state}
    order by lc.score desc, lc.created_at`);
  return rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    subjectProjectId: r.subject_project_id,
    subjectTitle: r.subject_title,
    minutes:
      r.session_date !== null && r.item_number !== null
        ? {
            sessionDate: r.session_date,
            itemNumber: r.item_number,
            text: r.item_text ?? "",
            outcome: r.outcome,
            documentId: r.document_id,
            page: r.page,
          }
        : null,
    candidateProjectId: r.candidate_project_id,
    candidateSlug: r.candidate_slug,
    candidateTitle: r.candidate_title,
    score: Number(r.score),
    signals: r.signals,
    state: r.state,
    createdAt: r.created_at,
  }));
}

/** Writes one audit_log row (every admin write does, in its own transaction). */
export async function writeAuditLog(
  tx: Tx,
  entry: {
    jurisdictionId: number;
    actor: string;
    entity: string;
    entityId: string;
    action: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await tx.execute(sql`
    insert into audit_log (jurisdiction_id, actor, entity, entity_id, action, before, after)
    values (${entry.jurisdictionId}, ${entry.actor}, ${entry.entity}, ${entry.entityId},
      ${entry.action}, ${JSON.stringify(entry.before ?? null)}::jsonb,
      ${JSON.stringify(entry.after ?? null)}::jsonb)`);
}

async function projectRow(tx: Tx, id: string) {
  const [row] = await tx.execute<{
    id: string;
    jurisdiction_id: number;
    merged_into_id: string | null;
    status: string;
  }>(
    sql`select id, jurisdiction_id, merged_into_id, status from project where id = ${id} for update`,
  );
  if (!row) throw new AdminError(`project ${id} not found`);
  return row;
}

/** Merge `projectId` into `intoId`; its own merged projects move along (one level only). */
async function merge(tx: Tx, projectId: string, intoId: string, actor: string, reason: string) {
  if (projectId === intoId) throw new AdminError("a project can't be merged into itself");
  const p = await projectRow(tx, projectId);
  const into = await projectRow(tx, intoId);
  if (into.merged_into_id) throw new AdminError("the target is itself merged; pick its project");
  if (p.jurisdiction_id !== into.jurisdiction_id) throw new AdminError("different cities");
  await tx.execute(sql`update project set merged_into_id = ${intoId} where id = ${projectId}`);
  await tx.execute(
    sql`update project set merged_into_id = ${intoId} where merged_into_id = ${projectId}`,
  );
  await tx.execute(sql`
    insert into link_candidate (jurisdiction_id, subject, subject_project_id, candidate_project_id,
      score, signals, state, decided_at)
    values (${p.jurisdiction_id}, ${`project:${projectId}`}, ${projectId}, ${intoId}, 1,
      ${JSON.stringify({ reviewer: reason })}::jsonb, 'approved', now())
    on conflict (jurisdiction_id, subject, candidate_project_id)
      do update set state = 'approved', decided_at = now()`);
  await writeAuditLog(tx, {
    jurisdictionId: p.jurisdiction_id,
    actor,
    entity: "project",
    entityId: projectId,
    action: "merge",
    before: { merged_into_id: p.merged_into_id },
    after: { merged_into_id: intoId, reason },
  });
}

export async function mergeProjects(
  db: Db,
  args: { projectId: string; intoId: string; actor: string },
) {
  await db.transaction((tx) => merge(tx, args.projectId, args.intoId, args.actor, "manual merge"));
}

/** Undo a merge. The pair is recorded as rejected, so the linker never merges it again. */
export async function splitProject(db: Db, args: { projectId: string; actor: string }) {
  await db.transaction(async (tx) => {
    const p = await projectRow(tx, args.projectId);
    if (!p.merged_into_id) throw new AdminError("this project isn't merged");
    await tx.execute(sql`update project set merged_into_id = null where id = ${args.projectId}`);
    await tx.execute(sql`
      insert into link_candidate (jurisdiction_id, subject, subject_project_id,
        candidate_project_id, score, signals, state, decided_at)
      values (${p.jurisdiction_id}, ${`project:${args.projectId}`}, ${args.projectId},
        ${p.merged_into_id}, 0, '{"reviewer": "split"}'::jsonb, 'rejected', now())
      on conflict (jurisdiction_id, subject, candidate_project_id)
        do update set state = 'rejected', decided_at = now()`);
    await writeAuditLog(tx, {
      jurisdictionId: p.jurisdiction_id,
      actor: args.actor,
      entity: "project",
      entityId: args.projectId,
      action: "split",
      before: { merged_into_id: p.merged_into_id },
      after: { merged_into_id: null },
    });
  });
}

/** Approve or reject a linker candidate. Approving a folder attaches its files to the project;
 * approving a project pair merges the earlier-stage subject into the candidate; approving a
 * council decision from the minutes places it on the project (the next daily run writes its
 * timeline event and status). */
export async function decideCandidate(
  db: Db,
  args: { id: string; decision: "approve" | "reject"; actor: string },
) {
  await db.transaction(async (tx) => {
    const [c] = await tx.execute<{
      jurisdiction_id: number;
      subject: string;
      subject_project_id: string | null;
      candidate_project_id: string;
      state: string;
    }>(sql`select jurisdiction_id, subject, subject_project_id, candidate_project_id, state
           from link_candidate where id = ${args.id} for update`);
    if (!c) throw new AdminError("candidate not found");
    if (c.state !== "pending_review") throw new AdminError(`already decided (${c.state})`);
    const state = args.decision === "approve" ? "approved" : "rejected";
    await tx.execute(sql`update link_candidate set state = ${state}::review_state, decided_at = now()
                         where id = ${args.id}`);
    if (args.decision === "approve") {
      if (c.subject_project_id) {
        await merge(
          tx,
          c.subject_project_id,
          c.candidate_project_id,
          args.actor,
          "review approved",
        );
      } else if (c.subject.startsWith(MINUTES)) {
        await tx.execute(sql`
          update agenda_item set project_id = ${c.candidate_project_id}::uuid
          where id::text = ${c.subject.slice(MINUTES.length)} and project_id is null`);
      } else if (c.subject.startsWith("group:")) {
        const [, adapter, group] = c.subject.split(":");
        await tx.execute(sql`
          insert into project_document (jurisdiction_id, project_id, raw_document_id, role)
          select distinct f.jurisdiction_id, ${c.candidate_project_id}::uuid, d.id,
                 d.doc_type::document_role
          from "fetch" f join source s on s.id = f.source_id
          join raw_document d on d.id = f.raw_document_id
          where s.adapter = ${adapter} and f.hints->>'group' = ${group}
            and d.doc_type is not null and d.doc_type <> 'registru_opinii'
          on conflict do nothing`);
      }
    }
    await writeAuditLog(tx, {
      jurisdictionId: c.jurisdiction_id,
      actor: args.actor,
      entity: "link_candidate",
      entityId: args.id,
      action: args.decision,
      before: { state: c.state },
      after: { state, subject: c.subject, candidate: c.candidate_project_id },
    });
  });
}

/** Place a project by hand (precision "manual"); the geocoder never changes it again. */
export async function setManualLocation(
  db: Db,
  args: { projectId: string; lon: number; lat: number; actor: string },
) {
  const { projectId, lon, lat, actor } = args;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new AdminError("invalid coordinates");
  await db.transaction(async (tx) => {
    const [p] = await tx.execute<{
      jurisdiction_id: number;
      lon: number | null;
      lat: number | null;
      precision: string | null;
      inside: boolean;
    }>(sql`
      select p.jurisdiction_id, ST_X(p.geom) as lon, ST_Y(p.geom) as lat,
             p.geom_precision::text as precision,
             ST_Intersects(j.bbox, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)) as inside
      from project p join jurisdiction j on j.id = p.jurisdiction_id
      where p.id = ${projectId} for update of p`);
    if (!p) throw new AdminError("project not found");
    if (!p.inside) throw new AdminError("the point is outside the city");
    const location = { value: "manual", method: `placed by ${actor}`, confidence: "high", page: null,
                       source_document_id: null }; // prettier-ignore
    await tx.execute(sql`
      update project set geom = ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326),
        geom_precision = 'manual',
        indicators = jsonb_set(indicators, '{location}', ${JSON.stringify(location)}::jsonb),
        updated_at = now()
      where id = ${projectId}`);
    await writeAuditLog(tx, {
      jurisdictionId: p.jurisdiction_id,
      actor,
      entity: "project",
      entityId: projectId,
      action: "set_location",
      before: { lon: p.lon, lat: p.lat, precision: p.precision },
      after: { lon, lat, precision: "manual" },
    });
  });
}

export type RerunStage = "extract" | "classify" | "fields";

/** Mark a document for the next daily run: forget its text, its type, or the fields read from
 * its projects, so the stage runs again (and everything after it follows from the new input). */
export async function requestRerun(
  db: Db,
  args: { rawDocumentId: string; stage: RerunStage; actor: string },
) {
  const { rawDocumentId: id, stage, actor } = args;
  await db.transaction(async (tx) => {
    const [d] = await tx.execute<{ jurisdiction_id: number; text_r2_key: string | null }>(
      sql`select jurisdiction_id, text_r2_key from raw_document where id = ${id} for update`,
    );
    if (!d) throw new AdminError("document not found");
    const fields = sql`
      delete from extraction_run where task = 'extract_fields' and raw_document_id in (
        select pd2.raw_document_id from project_document pd
        join project_document pd2 on pd2.project_id = pd.project_id
        where pd.raw_document_id = ${id})`;
    if (stage === "extract") {
      await tx.execute(
        sql`update raw_document set text_r2_key = null, text_head = null where id = ${id}`,
      );
    }
    if (stage === "extract" || stage === "classify") {
      await tx.execute(sql`delete from extraction_run
                           where raw_document_id = ${id} and task = 'classify' and model = 'rules'`);
    }
    await tx.execute(fields);
    await writeAuditLog(tx, {
      jurisdictionId: d.jurisdiction_id,
      actor,
      entity: "raw_document",
      entityId: id,
      action: `rerun_${stage}`,
      before: { text_r2_key: d.text_r2_key },
    });
  });
}

export interface AdminProject {
  id: string;
  slug: string;
  title: string;
  status: string;
  kind: string;
  address: string | null;
  precision: string | null;
  lon: number | null;
  lat: number | null;
  mergedIntoId: string | null;
  merged: { id: string; slug: string; title: string }[];
  documents: { id: string; role: string; url: string | null; ocr: boolean; pages: number | null }[];
}

export async function listAdminProjects(db: Db, city: string) {
  return db.execute<{
    id: string;
    slug: string;
    title: string;
    status: string;
    precision: string | null;
    merged_into_id: string | null;
    documents: number;
  }>(sql`
    select p.id, p.slug, p.title, p.status, p.geom_precision as precision, p.merged_into_id,
           (select count(*)::int from project_document pd where pd.project_id = p.id) as documents
    from project p join jurisdiction j on j.id = p.jurisdiction_id and j.slug = ${city}
    order by p.merged_into_id nulls first, p.title`);
}

export async function getAdminProject(db: Db, id: string): Promise<AdminProject | null> {
  const [p] = await db.execute<{
    id: string;
    slug: string;
    title: string;
    status: string;
    kind: string;
    address: string | null;
    precision: string | null;
    lon: number | null;
    lat: number | null;
    merged_into_id: string | null;
  }>(sql`
    select id, slug, title, status, kind, address_text as address, geom_precision as precision,
           ST_X(geom) as lon, ST_Y(geom) as lat, merged_into_id
    from project where id = ${id}`);
  if (!p) return null;
  const merged = await db.execute<{ id: string; slug: string; title: string }>(
    sql`select id, slug, title from project where merged_into_id = ${id} order by title`,
  );
  const documents = await db.execute<{
    id: string;
    role: string;
    url: string | null;
    ocr: boolean;
    pages: number | null;
  }>(sql`
    select d.id, pd.role::text as role, d.ocr_used as ocr, d.page_count as pages,
           (select f.url from "fetch" f where f.raw_document_id = d.id
            order by f.fetched_at desc nulls last limit 1) as url
    from project_document pd join raw_document d on d.id = pd.raw_document_id
    where pd.project_id in (select ${id}::uuid union select id from project where merged_into_id = ${id})
    order by pd.role, d.created_at`);
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    status: p.status,
    kind: p.kind,
    address: p.address,
    precision: p.precision,
    lon: p.lon,
    lat: p.lat,
    mergedIntoId: p.merged_into_id,
    merged: [...merged],
    documents: [...documents],
  };
}
