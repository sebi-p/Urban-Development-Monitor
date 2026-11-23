/**
 * Accuracy audits (M5.2, PLAN §10.7; ADR 0019): a seeded random sample of published projects,
 * each value checked by hand against its source page, and the measured accuracy published on
 * /metodologie. Writes are admin actions, each with an `audit_log` row (ADR 0012).
 */
import {
  AUDIT_FIELDS,
  AUDIT_VERDICTS,
  type AuditField,
  type AuditVerdict,
  type ProjectIndicators,
  type ProjectKind,
  type ProjectStatus,
} from "@mdu/shared";
import { eq, sql } from "drizzle-orm";
import { AdminError, writeAuditLog as logAudit } from "./admin.ts";
import type { Db } from "./client.ts";
import { getProject, type ProjectDetail } from "./queries.ts";
import { audit, auditCheck, auditItem, jurisdiction } from "./schema/index.ts";

export const AUDIT_MAX_SIZE = 500;
/** PLAN §10.7 targets. */
export const AUDIT_TARGETS: Partial<Record<AuditField, number>> = { status: 0.95, location: 0.9 };

/** A link to a source page. `documentId` is set when we hold a mirrored copy (R2). */
export interface SourceRef {
  url: string;
  page: number | null;
  documentId: string | null;
}

export interface AuditSnapshot {
  slug: string;
  title: string;
  kind: ProjectKind;
  status: ProjectStatus;
  /** The latest event, which set the status. */
  statusEvent: { title: string | null; date: string | null; source: SourceRef | null };
  location: {
    address: string | null;
    precision: string | null;
    lon: number | null;
    lat: number | null;
    method: string | null;
    source: SourceRef | null;
  };
  figures: { key: string; value: unknown; source: SourceRef | null }[];
  summary: { text: string; source: SourceRef | null } | null;
  consultation: {
    opensOn: string | null;
    closesOn: string | null;
    email: string | null;
    source: SourceRef | null;
  } | null;
  documents: {
    label: string | null;
    role: string | null;
    url: string;
    documentId: string | null;
  }[];
}

/** The fields a snapshot can be checked on, with the figure keys. */
export function checksFor(s: AuditSnapshot): { field: AuditField; key: string }[] {
  const out: { field: AuditField; key: string }[] = [
    { field: "status", key: "" },
    { field: "location", key: "" },
    { field: "kind", key: "" },
    { field: "title", key: "" },
  ];
  for (const f of s.figures) out.push({ field: "figure", key: f.key });
  if (s.summary) out.push({ field: "summary", key: "" });
  if (s.consultation) out.push({ field: "consultation", key: "" });
  return out;
}

const NOT_FIGURES = new Set(["location", "summary"]);

async function mirrored(db: Db, urls: string[]): Promise<Map<string, string>> {
  if (!urls.length) return new Map();
  const rows = await db.execute<{ url: string; id: string }>(sql`
    select distinct on (f.url) f.url, d.id from "fetch" f
    join raw_document d on d.id = f.raw_document_id
    where f.url in ${urls} and d.r2_key is not null
    order by f.url, f.fetched_at desc nulls last`);
  return new Map(rows.map((r) => [r.url, r.id]));
}

export async function snapshotOf(db: Db, p: ProjectDetail): Promise<AuditSnapshot> {
  const ind = p.indicators as ProjectIndicators & Record<string, unknown>;
  const consultation = p.consultations[0] ?? null;
  const urls = [
    ...p.documents.map((d) => d.url),
    p.sourceUrl,
    ind.location?.source_url,
    ind.summary?.source_url,
    consultation?.sourceUrl,
    ...Object.values(ind).map((v) => (v as { source_url?: string } | null)?.source_url),
  ].filter((u): u is string => typeof u === "string" && u.length > 0);
  const held = await mirrored(db, [...new Set(urls)]);
  const ref = (
    url: string | null | undefined,
    page: number | null | undefined,
  ): SourceRef | null =>
    url ? { url, page: page ?? null, documentId: held.get(url) ?? null } : null;
  const latest = p.events.at(-1);
  return {
    slug: p.slug,
    title: p.title,
    kind: p.kind,
    status: p.status,
    statusEvent: {
      title: p.eventTitle,
      date: p.eventDate,
      source: ref(latest?.sourceUrl ?? p.sourceUrl, null),
    },
    location: {
      address: p.address,
      precision: p.geomPrecision,
      lon: p.lon,
      lat: p.lat,
      method: ind.location?.method ?? null,
      source: ref(ind.location?.source_url, ind.location?.page),
    },
    figures: Object.entries(ind)
      .filter(([k, v]) => !NOT_FIGURES.has(k) && v && typeof v === "object" && "value" in v)
      .map(([key, v]) => {
        const s = v as { value: unknown; source_url?: string; page?: number };
        return { key, value: s.value, source: ref(s.source_url, s.page) };
      })
      .sort((a, b) => a.key.localeCompare(b.key)),
    summary: p.summaryRo
      ? { text: p.summaryRo, source: ref(ind.summary?.source_url, ind.summary?.page) }
      : null,
    consultation: consultation
      ? {
          opensOn: consultation.opensOn,
          closesOn: consultation.closesOn,
          email: consultation.submitEmail,
          source: ref(consultation.sourceUrl, consultation.page),
        }
      : null,
    documents: p.documents.map((d) => ({
      label: d.label,
      role: d.role ?? null,
      url: d.url,
      documentId: held.get(d.url) ?? null,
    })),
  };
}

/** Draws a new sample: `size` published projects in a seeded random order, snapshotted now. */
export async function startAudit(
  db: Db,
  args: { city: string; size: number; actor: string; seed?: number },
): Promise<string> {
  const size = Math.trunc(args.size);
  if (!(size >= 1 && size <= AUDIT_MAX_SIZE)) throw new AdminError("invalid sample size");
  const seed = args.seed ?? Math.floor(Math.random() * 2 ** 31);
  const [j] = await db
    .select({ id: jurisdiction.id })
    .from(jurisdiction)
    .where(eq(jurisdiction.slug, args.city));
  if (!j) throw new AdminError("unknown city");
  const picked = await db.execute<{ slug: string }>(sql`
    select slug from project
    where jurisdiction_id = ${j.id} and merged_into_id is null
      and review_state in ('auto_published', 'approved')
    order by md5(${String(seed)} || id::text) limit ${size}`);
  if (!picked.length) throw new AdminError("no published projects to sample");
  const items: { projectId: string; snapshot: AuditSnapshot }[] = [];
  for (const { slug } of picked) {
    const found = await getProject(db, args.city, slug);
    if (found.found) {
      items.push({ projectId: found.project.id, snapshot: await snapshotOf(db, found.project) });
    }
  }
  return db.transaction(async (tx) => {
    const [a] = await tx
      .insert(audit)
      .values({ jurisdictionId: j.id, seed, sampleSize: items.length, createdBy: args.actor })
      .returning({ id: audit.id });
    await tx.insert(auditItem).values(
      items.map((it, i) => ({
        auditId: a!.id,
        projectId: it.projectId,
        position: i + 1,
        snapshot: it.snapshot,
      })),
    );
    await logAudit(tx, {
      jurisdictionId: j.id,
      actor: args.actor,
      entity: "audit",
      entityId: a!.id,
      action: "start",
      after: { seed, size: items.length },
    });
    return a!.id;
  });
}

/** Records (or changes) one verdict. */
export async function recordCheck(
  db: Db,
  args: {
    itemId: string;
    field: string;
    key?: string;
    verdict: string;
    note?: string | null;
    actor: string;
  },
) {
  const field = args.field as AuditField;
  const verdict = args.verdict as AuditVerdict;
  const key = args.key ?? "";
  if (!AUDIT_FIELDS.includes(field)) throw new AdminError("unknown field");
  if (!AUDIT_VERDICTS.includes(verdict)) throw new AdminError("unknown verdict");
  await db.transaction(async (tx) => {
    const [it] = await tx.execute<{
      snapshot: AuditSnapshot;
      jurisdiction_id: number;
      published_at: string | null;
      before: string | null;
    }>(sql`
      select i.snapshot, a.jurisdiction_id, a.published_at::text,
             (select c.verdict::text from audit_check c
              where c.item_id = i.id and c.field = ${field} and c.key = ${key}) as before
      from audit_item i join audit a on a.id = i.audit_id where i.id = ${args.itemId}`);
    if (!it) throw new AdminError("audit item not found");
    if (it.published_at) throw new AdminError("this audit is published");
    if (!checksFor(it.snapshot).some((c) => c.field === field && c.key === key)) {
      throw new AdminError("nothing to check for this field");
    }
    const note = args.note?.trim() || null;
    await tx
      .insert(auditCheck)
      .values({ itemId: args.itemId, field, key, verdict, note, checkedBy: args.actor })
      .onConflictDoUpdate({
        target: [auditCheck.itemId, auditCheck.field, auditCheck.key],
        set: { verdict, note, checkedBy: args.actor, checkedAt: sql`now()` },
      });
    await logAudit(tx, {
      jurisdictionId: it.jurisdiction_id,
      actor: args.actor,
      entity: "audit_item",
      entityId: args.itemId,
      action: "check",
      before: it.before ? { field, key, verdict: it.before } : null,
      after: { field, key, verdict, note },
    });
  });
}

/** Publishes an audit once every sampled project has its status and location checked. */
export async function publishAudit(db: Db, args: { auditId: string; actor: string }) {
  await db.transaction(async (tx) => {
    const [a] = await tx.execute<{ jurisdiction_id: number; published: boolean; open: number }>(
      sql`
      select a.jurisdiction_id, a.published_at is not null as published,
             (select count(*)::int from audit_item i where i.audit_id = a.id and
                (select count(*) from audit_check c where c.item_id = i.id
                   and c.field in ('status', 'location')) < 2) as open
      from audit a where a.id = ${args.auditId} for update`,
    );
    if (!a) throw new AdminError("audit not found");
    if (a.published) throw new AdminError("already published");
    if (a.open > 0) throw new AdminError(`${a.open} projects still need status and location`);
    await tx
      .update(audit)
      .set({ publishedAt: sql`now()` })
      .where(eq(audit.id, args.auditId));
    await logAudit(tx, {
      jurisdictionId: a.jurisdiction_id,
      actor: args.actor,
      entity: "audit",
      entityId: args.auditId,
      action: "publish",
    });
  });
}

export interface AuditSummary {
  id: string;
  seed: number;
  sampleSize: number;
  createdBy: string;
  createdAt: string;
  publishedAt: string | null;
  /** Projects with status and location checked. */
  done: number;
}

export async function listAudits(db: Db, city: string): Promise<AuditSummary[]> {
  const rows = await db.execute<{
    id: string;
    seed: number;
    sample_size: number;
    created_by: string;
    created_at: string;
    published_at: string | null;
    done: number;
  }>(sql`
    select a.id, a.seed, a.sample_size, a.created_by, to_json(a.created_at) #>> '{}' as created_at,
           to_json(a.published_at) #>> '{}' as published_at,
           (select count(*)::int from audit_item i where i.audit_id = a.id and
              (select count(*) from audit_check c where c.item_id = i.id
                 and c.field in ('status', 'location')) = 2) as done
    from audit a join jurisdiction j on j.id = a.jurisdiction_id
    where j.slug = ${city} order by a.created_at desc`);
  return rows.map((r) => ({
    id: r.id,
    seed: r.seed,
    sampleSize: r.sample_size,
    createdBy: r.created_by,
    createdAt: r.created_at,
    publishedAt: r.published_at,
    done: r.done,
  }));
}

export interface AuditItemView {
  id: string;
  position: number;
  snapshot: AuditSnapshot;
  checks: { field: AuditField; key: string; verdict: AuditVerdict; note: string | null }[];
}

export async function getAuditItem(
  db: Db,
  auditId: string,
  position: number,
): Promise<{ audit: AuditSummary & { city: string }; item: AuditItemView } | null> {
  const [row] = await db.execute<{
    id: string;
    position: number;
    snapshot: AuditSnapshot;
    city: string;
    checks: AuditItemView["checks"] | null;
  }>(sql`
    select i.id, i.position, i.snapshot, j.slug as city,
           (select json_agg(json_build_object('field', c.field, 'key', c.key,
                   'verdict', c.verdict, 'note', c.note) order by c.field, c.key)
            from audit_check c where c.item_id = i.id) as checks
    from audit_item i join audit a on a.id = i.audit_id
    join jurisdiction j on j.id = a.jurisdiction_id
    where i.audit_id = ${auditId} and i.position = ${position}`);
  if (!row) return null;
  const summary = (await listAudits(db, row.city)).find((a) => a.id === auditId)!;
  return {
    audit: { ...summary, city: row.city },
    item: { id: row.id, position: row.position, snapshot: row.snapshot, checks: row.checks ?? [] },
  };
}

/** A mirrored document for the audit viewer (admin only). */
export async function auditDocument(
  db: Db,
  id: string,
): Promise<{ r2Key: string; mime: string } | null> {
  const [d] = await db.execute<{ r2_key: string | null; mime: string }>(
    sql`select r2_key, mime from raw_document where id = ${id}`,
  );
  return d?.r2_key ? { r2Key: d.r2_key, mime: d.mime } : null;
}

export interface FieldResult {
  field: AuditField;
  checked: number; // correct + wrong
  correct: number;
  unsure: number;
  /** correct / checked, and its Wilson 95% interval. */
  accuracy: number | null;
  low: number | null;
  high: number | null;
  target: number | null;
}

/** Wilson score interval (95%) for k successes in n trials. */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export interface AuditResults {
  publishedAt: string;
  projects: number;
  fields: FieldResult[];
}

/** The latest published audit's accuracy per field (null when none is published). */
export async function latestAuditResults(db: Db, city: string): Promise<AuditResults | null> {
  const [a] = await db.execute<{ id: string; published_at: string; projects: number }>(sql`
    select a.id, to_json(a.published_at) #>> '{}' as published_at,
           (select count(*)::int from audit_item i where i.audit_id = a.id) as projects
    from audit a join jurisdiction j on j.id = a.jurisdiction_id
    where j.slug = ${city} and a.published_at is not null
    order by a.published_at desc limit 1`);
  if (!a) return null;
  const counts = await db.execute<{ field: AuditField; verdict: AuditVerdict; n: number }>(sql`
    select c.field, c.verdict, count(*)::int as n from audit_check c
    join audit_item i on i.id = c.item_id where i.audit_id = ${a.id}
    group by 1, 2`);
  const fields = AUDIT_FIELDS.map((field) => {
    const n = (v: AuditVerdict) => counts.find((c) => c.field === field && c.verdict === v)?.n ?? 0;
    const correct = n("correct");
    const checked = correct + n("wrong");
    const [low, high] = wilson(correct, checked);
    return {
      field,
      checked,
      correct,
      unsure: n("unsure"),
      accuracy: checked ? correct / checked : null,
      low: checked ? low : null,
      high: checked ? high : null,
      target: AUDIT_TARGETS[field] ?? null,
    };
  }).filter((f) => f.checked + f.unsure > 0);
  return { publishedAt: a.published_at, projects: a.projects, fields };
}
