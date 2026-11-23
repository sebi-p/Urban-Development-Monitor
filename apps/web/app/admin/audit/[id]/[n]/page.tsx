import {
  checksFor,
  getAuditItem,
  type AuditItemView,
  type AuditSnapshot,
  type SourceRef,
} from "@mdu/db";
import { AUDIT_VERDICTS, type AuditField, type AuditVerdict } from "@mdu/shared";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { adminLogin } from "@/auth";
import { getDb } from "@/lib/db";
import { r2Configured } from "@/lib/r2";
import { cn } from "@/lib/utils";
import { checkAction } from "../../../actions";

type Props = {
  params: Promise<{ id: string; n: string }>;
  searchParams: Promise<{ doc?: string; page?: string }>;
};

const VERDICT_STYLE: Record<AuditVerdict, string> = {
  correct: "border-emerald-600 bg-emerald-600 text-white",
  wrong: "border-red-600 bg-red-600 text-white",
  unsure: "border-amber-500 bg-amber-500 text-white",
  not_applicable: "border-slate-500 bg-slate-500 text-white",
};

/** Where to look: our mirrored copy in the viewer, or the city's file in a new tab. */
function SourceLink({ base, source }: { base: string; source: SourceRef | null }) {
  if (!source) return null;
  const page = source.page ? `#page=${source.page}` : "";
  const label = source.page ? `p. ${source.page}` : "sursa";
  return source.documentId ? (
    <Link
      href={`${base}?doc=${source.documentId}${source.page ? `&page=${source.page}` : ""}`}
      className="text-xs"
    >
      {label} →
    </Link>
  ) : (
    <a href={`${source.url}${page}`} target="_blank" rel="noopener noreferrer" className="text-xs">
      {label} ↗
    </a>
  );
}

async function Check({
  item,
  field,
  checkKey = "",
  label,
  value,
  source,
  base,
  auditId,
  locked,
}: {
  item: AuditItemView;
  field: AuditField;
  checkKey?: string;
  label: string;
  value: ReactNode;
  source: SourceRef | null;
  base: string;
  auditId: string;
  locked: boolean;
}) {
  const t = await getTranslations("Admin");
  const current = item.checks.find((c) => c.field === field && c.key === checkKey);
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3" data-field={field}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          {label}
        </span>
        <SourceLink base={base} source={source} />
      </div>
      <div className="mt-1 text-sm text-slate-900">{value}</div>
      <form action={checkAction} className="mt-2 flex flex-wrap items-center gap-1.5">
        <input type="hidden" name="itemId" value={item.id} />
        <input type="hidden" name="field" value={field} />
        <input type="hidden" name="key" value={checkKey} />
        <input type="hidden" name="auditId" value={auditId} />
        <input type="hidden" name="position" value={item.position} />
        {AUDIT_VERDICTS.map((v) => (
          <button
            key={v}
            type="submit"
            name="verdict"
            value={v}
            disabled={locked}
            aria-pressed={current?.verdict === v}
            className={cn(
              "min-h-9 rounded-full border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 disabled:opacity-60",
              current?.verdict === v && VERDICT_STYLE[v],
            )}
          >
            {t(`verdict_${v}`)}
          </button>
        ))}
        <input
          name="note"
          defaultValue={current?.note ?? ""}
          placeholder={t("auditNote")}
          aria-label={t("auditNote")}
          disabled={locked}
          className="order-first h-9 w-full rounded-lg border border-slate-300 px-2 text-xs"
        />
      </form>
    </li>
  );
}

function firstSource(s: AuditSnapshot): SourceRef | null {
  const all = [
    s.location.source,
    ...s.figures.map((f) => f.source),
    s.summary?.source ?? null,
    s.consultation?.source ?? null,
    s.statusEvent.source,
  ];
  return all.find((x) => x?.documentId) ?? null;
}

/** One sampled project: its values with verdicts on the left, the source PDF on the right. */
export default async function AuditItemPage({ params, searchParams }: Props) {
  if (!(await adminLogin())) return null;
  const { id, n } = await params;
  const position = Number(n);
  if (!Number.isInteger(position) || position < 1) notFound();
  const found = await getAuditItem(getDb(), id, position);
  if (!found) notFound();
  const { audit, item } = found;
  const s = item.snapshot;
  const t = await getTranslations("Admin");
  const status = await getTranslations("Status");
  const kind = await getTranslations("Kind");
  const ind = await getTranslations("Indicators");
  const base = `/admin/audit/${id}/${position}`;
  const locked = audit.publishedAt !== null;
  const q = await searchParams;
  const shown = firstSource(s);
  const doc = q.doc ?? shown?.documentId ?? null;
  const page = q.doc ? q.page : shown?.page ? String(shown.page) : undefined;
  const todo = checksFor(s).length - item.checks.length;
  const common = { item, base, auditId: id, locked };
  const figureLabel = (key: string) => (ind.has(key) ? ind(key) : key);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_1fr]">
      <section aria-labelledby="audit-heading">
        <nav className="mb-2 flex flex-wrap items-center gap-3 text-sm">
          <Link href="/admin/audit">{t("auditTitle")}</Link>
          <span className="text-slate-500">
            {t("auditPosition", { n: position, total: audit.sampleSize })}
          </span>
          {position > 1 && <Link href={`/admin/audit/${id}/${position - 1}`}>← {t("prev")}</Link>}
          {position < audit.sampleSize && (
            <Link href={`/admin/audit/${id}/${position + 1}`}>{t("next")} →</Link>
          )}
        </nav>
        <h2 id="audit-heading" className="text-lg leading-snug font-semibold">
          <a href={`/${audit.city}/proiecte/${s.slug}`} target="_blank" rel="noopener noreferrer">
            {s.title}
          </a>
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          {todo > 0 ? t("auditTodo", { count: todo }) : t("auditItemDone")}
        </p>
        <ul className="space-y-2">
          <Check
            {...common}
            field="status"
            label={t("status")}
            source={s.statusEvent.source}
            value={
              <>
                {status(s.status)}
                {s.statusEvent.title && (
                  <span className="block text-xs text-slate-500">
                    {s.statusEvent.date} · {s.statusEvent.title}
                  </span>
                )}
              </>
            }
          />
          <Check
            {...common}
            field="location"
            label={t("location")}
            source={s.location.source}
            value={
              <>
                {s.location.address ?? t("noLocation")}
                <span className="block text-xs text-slate-500">
                  {s.location.precision ?? "—"}
                  {s.location.method ? ` · ${s.location.method}` : ""}
                  {s.location.lat !== null && s.location.lon !== null && (
                    <>
                      {" · "}
                      <a
                        href={`https://www.openstreetmap.org/?mlat=${s.location.lat}&mlon=${s.location.lon}#map=18/${s.location.lat}/${s.location.lon}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t("auditOnMap")}
                      </a>
                    </>
                  )}
                </span>
              </>
            }
          />
          <Check
            {...common}
            field="kind"
            label={t("auditKind")}
            source={null}
            value={kind(s.kind)}
          />
          <Check
            {...common}
            field="title"
            label={t("auditTitleField")}
            source={null}
            value={s.title}
          />
          {s.figures.map((fig) => (
            <Check
              {...common}
              key={fig.key}
              field="figure"
              checkKey={fig.key}
              label={figureLabel(fig.key)}
              source={fig.source}
              value={Array.isArray(fig.value) ? fig.value.join(", ") : String(fig.value)}
            />
          ))}
          {s.summary && (
            <Check
              {...common}
              field="summary"
              label={t("auditSummary")}
              source={s.summary.source}
              value={s.summary.text}
            />
          )}
          {s.consultation && (
            <Check
              {...common}
              field="consultation"
              label={t("auditConsultation")}
              source={s.consultation.source}
              value={
                <>
                  {s.consultation.opensOn ?? "?"} – {s.consultation.closesOn ?? "?"}
                  {s.consultation.email && (
                    <span className="block text-xs text-slate-500">{s.consultation.email}</span>
                  )}
                </>
              }
            />
          )}
        </ul>
        <h3 className="mt-5 mb-1 text-sm font-semibold">{t("documents")}</h3>
        <ul className="space-y-1 text-xs">
          {s.documents.map((d) => (
            <li key={d.url}>
              {d.documentId ? (
                <Link href={`${base}?doc=${d.documentId}`} aria-current={d.documentId === doc}>
                  {d.label ?? d.role ?? d.url}
                </Link>
              ) : (
                <a href={d.url} target="_blank" rel="noopener noreferrer">
                  {d.label ?? d.role ?? d.url} ↗
                </a>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section
        aria-label={t("auditViewer")}
        className="lg:sticky lg:top-[calc(var(--app-bar-height)+1rem)] lg:self-start"
      >
        {!r2Configured() ? (
          <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{t("auditNoR2")}</p>
        ) : doc ? (
          <iframe
            key={`${doc}-${page ?? ""}`}
            title={t("auditViewer")}
            src={`/admin/documents/${doc}${page ? `#page=${page}` : ""}`}
            className="h-[80vh] w-full rounded-xl border border-slate-200 bg-white"
          />
        ) : (
          <p className="rounded-xl bg-slate-100 p-4 text-sm text-slate-600">{t("auditNoDoc")}</p>
        )}
      </section>
    </div>
  );
}
