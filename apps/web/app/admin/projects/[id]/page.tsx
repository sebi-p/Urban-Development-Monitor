import { getAdminProject, getJurisdiction, listAdminProjects } from "@mdu/db";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocationEditor } from "@/components/LocationEditor";
import { adminLogin } from "@/auth";
import { getDb } from "@/lib/db";
import { mergeAction, rerunAction, splitAction } from "../../actions";

const CITY = "brasov";
const STAGES = [
  ["extract", "rerunExtract"],
  ["classify", "rerunClassify"],
  ["fields", "rerunFields"],
] as const;

export default async function AdminProject({ params }: { params: Promise<{ id: string }> }) {
  if (!(await adminLogin())) return null; // see app/admin/page.tsx
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = getDb();
  const [p, j, all] = await Promise.all([
    getAdminProject(db, id),
    getJurisdiction(db, CITY),
    listAdminProjects(db, CITY),
  ]);
  if (!p || !j) notFound();
  const t = await getTranslations("Admin");
  const status = await getTranslations("Status");
  const docType = await getTranslations("DocType");
  const targets = all.filter((o) => o.id !== p.id && !o.merged_into_id);
  return (
    <>
      <nav className="mb-2 text-sm">
        <Link href="/admin/projects">← {t("back")}</Link>
      </nav>
      <h2 className="mt-2 mb-3 text-xl font-semibold">{p.title}</h2>
      <p className="text-sm text-slate-600">
        {status(p.status as never)} · {p.address ?? "—"} · {p.precision ?? t("noLocation")}
      </p>

      <h3 className="mt-6 mb-2 text-base font-semibold">{t("location")}</h3>
      <LocationEditor
        projectId={p.id}
        bbox={j.bbox}
        point={p.lon !== null && p.lat !== null ? [p.lon, p.lat] : null}
      />

      <h3 className="mt-6 mb-2 text-base font-semibold">{t("merged")}</h3>
      {p.mergedIntoId ? (
        <form action={splitAction}>
          <input type="hidden" name="projectId" value={p.id} />
          <Link href={`/admin/projects/${p.mergedIntoId}`}>{t("open")}</Link>{" "}
          <button
            type="submit"
            className="inline-flex min-h-9 items-center rounded-full border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-100"
          >
            {t("split")}
          </button>
        </form>
      ) : (
        <form action={mergeAction}>
          <input type="hidden" name="projectId" value={p.id} />
          <label>
            {t("mergeInto")}{" "}
            <select
              name="intoId"
              required
              defaultValue=""
              className="min-h-9 max-w-80 rounded-lg border border-slate-300 bg-white px-2"
            >
              <option value="" disabled />
              {targets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </select>
          </label>{" "}
          <button
            type="submit"
            className="inline-flex min-h-9 items-center rounded-full border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-100"
          >
            {t("merge")}
          </button>
        </form>
      )}
      {p.merged.length > 0 && (
        <>
          <h4 className="mt-3 mb-1 text-sm font-semibold">{t("mergedHere")}</h4>
          <ul>
            {p.merged.map((m) => (
              <li key={m.id}>
                <Link href={`/admin/projects/${m.id}`}>{m.title}</Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="mt-6 mb-2 text-base font-semibold">{t("documents")}</h3>
      <table className="w-full border-collapse overflow-hidden rounded-[var(--radius-card)] bg-white text-sm shadow-[var(--shadow-card)] [&_td]:border-b [&_td]:border-slate-100 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-slate-600">
        <tbody>
          {p.documents.map((d) => (
            <tr key={d.id}>
              <td>
                {d.url ? (
                  <a href={d.url} rel="noopener noreferrer" target="_blank">
                    {docType(d.role as never)}
                  </a>
                ) : (
                  docType(d.role as never)
                )}
                {d.pages ? ` · ${d.pages} p.` : ""}
                {d.ocr ? " · OCR" : ""}
              </td>
              <td>
                <form
                  action={rerunAction}
                  className="inline-flex flex-wrap items-center gap-1.5"
                  aria-label={t("rerun")}
                >
                  <input type="hidden" name="documentId" value={d.id} />
                  <input type="hidden" name="projectId" value={p.id} />
                  {t("rerun")}:{" "}
                  {STAGES.map(([stage, label]) => (
                    <button
                      key={stage}
                      type="submit"
                      name="stage"
                      value={stage}
                      className="inline-flex min-h-9 items-center rounded-full border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-100"
                    >
                      {t(label)}
                    </button>
                  ))}
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
