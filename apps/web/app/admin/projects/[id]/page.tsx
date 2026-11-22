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
      <nav>
        <Link href="/admin/projects">← {t("back")}</Link>
      </nav>
      <h2>{p.title}</h2>
      <p className="meta">
        {status(p.status as never)} · {p.address ?? "—"} · {p.precision ?? t("noLocation")}
      </p>

      <h3>{t("location")}</h3>
      <LocationEditor
        projectId={p.id}
        bbox={j.bbox}
        point={p.lon !== null && p.lat !== null ? [p.lon, p.lat] : null}
      />

      <h3>{t("merged")}</h3>
      {p.mergedIntoId ? (
        <form action={splitAction}>
          <input type="hidden" name="projectId" value={p.id} />
          <Link href={`/admin/projects/${p.mergedIntoId}`}>{t("open")}</Link>{" "}
          <button type="submit">{t("split")}</button>
        </form>
      ) : (
        <form action={mergeAction}>
          <input type="hidden" name="projectId" value={p.id} />
          <label>
            {t("mergeInto")}{" "}
            <select name="intoId" required defaultValue="">
              <option value="" disabled />
              {targets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </select>
          </label>{" "}
          <button type="submit">{t("merge")}</button>
        </form>
      )}
      {p.merged.length > 0 && (
        <>
          <h4>{t("mergedHere")}</h4>
          <ul>
            {p.merged.map((m) => (
              <li key={m.id}>
                <Link href={`/admin/projects/${m.id}`}>{m.title}</Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>{t("documents")}</h3>
      <table className="admin-table">
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
                <form action={rerunAction} className="inline" aria-label={t("rerun")}>
                  <input type="hidden" name="documentId" value={d.id} />
                  <input type="hidden" name="projectId" value={p.id} />
                  {t("rerun")}:{" "}
                  {STAGES.map(([stage, label]) => (
                    <button key={stage} type="submit" name="stage" value={stage}>
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
