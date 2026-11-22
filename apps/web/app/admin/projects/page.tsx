import { listAdminProjects } from "@mdu/db";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { adminLogin } from "@/auth";
import { getDb } from "@/lib/db";

const CITY = "brasov";

export default async function AdminProjects() {
  if (!(await adminLogin())) return null; // see app/admin/page.tsx
  const t = await getTranslations("Admin");
  const status = await getTranslations("Status");
  const projects = await listAdminProjects(getDb(), CITY);
  return (
    <>
      <h2 className="mt-2 mb-3 text-xl font-semibold">{t("projects")}</h2>
      <table className="w-full border-collapse overflow-hidden rounded-[var(--radius-card)] bg-white text-sm shadow-[var(--shadow-card)] [&_td]:border-b [&_td]:border-slate-100 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-slate-600">
        <thead>
          <tr>
            <th>{t("projects")}</th>
            <th>{t("status")}</th>
            <th>{t("precision")}</th>
            <th>{t("documents")}</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id} className={p.merged_into_id ? "text-slate-400" : undefined}>
              <td>
                <Link href={`/admin/projects/${p.id}`}>{p.title}</Link>
                {p.merged_into_id ? ` (${t("merged")})` : ""}
              </td>
              <td>{status(p.status as never)}</td>
              <td>{p.precision ?? t("noLocation")}</td>
              <td>{p.documents}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
