import { listReviewQueue } from "@mdu/db";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { adminLogin } from "@/auth";
import { getDb } from "@/lib/db";
import { decideAction } from "./actions";

const CITY = "brasov"; // single city for now; the city switch comes with M4

export default async function ReviewQueue() {
  // Pages render even when the layout hides them, so each page checks the login itself.
  if (!(await adminLogin())) return null;
  const t = await getTranslations("Admin");
  const queue = await listReviewQueue(getDb(), CITY);
  return (
    <>
      <nav className="mb-2 flex gap-4 text-sm">
        <Link href="/admin/projects">{t("projects")}</Link>
        <Link href="/admin/audit">{t("auditTitle")}</Link>
      </nav>
      <h2 className="mt-2 mb-3 text-xl font-semibold">{t("queue")}</h2>
      {queue.length === 0 ? (
        <p>{t("queueEmpty")}</p>
      ) : (
        <table className="w-full border-collapse overflow-hidden rounded-[var(--radius-card)] bg-white text-sm shadow-[var(--shadow-card)] [&_td]:border-b [&_td]:border-slate-100 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-slate-600">
          <thead>
            <tr>
              <th>{t("subject")}</th>
              <th>{t("candidate")}</th>
              <th>{t("score")}</th>
              <th>{t("signals")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {queue.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.subjectProjectId ? (
                    <Link href={`/admin/projects/${c.subjectProjectId}`}>{c.subjectTitle}</Link>
                  ) : (
                    t("folder")
                  )}
                </td>
                <td>
                  <Link href={`/admin/projects/${c.candidateProjectId}`}>{c.candidateTitle}</Link>
                </td>
                <td>{c.score.toFixed(2)}</td>
                <td>
                  <code>{JSON.stringify(c.signals)}</code>
                </td>
                <td>
                  <form
                    action={decideAction}
                    className="inline-flex flex-wrap items-center gap-1.5"
                  >
                    <input type="hidden" name="id" value={c.id} />
                    <button
                      type="submit"
                      name="decision"
                      value="approve"
                      className="inline-flex min-h-9 items-center rounded-full bg-accent-700 px-3 text-sm font-medium text-white hover:bg-accent-800"
                    >
                      {t("approve")}
                    </button>{" "}
                    <button
                      type="submit"
                      name="decision"
                      value="reject"
                      className="inline-flex min-h-9 items-center rounded-full border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-100"
                    >
                      {t("reject")}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
