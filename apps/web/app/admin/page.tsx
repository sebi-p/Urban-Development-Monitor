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
      <nav>
        <Link href="/admin/projects">{t("projects")}</Link>
      </nav>
      <h2>{t("queue")}</h2>
      {queue.length === 0 ? (
        <p>{t("queueEmpty")}</p>
      ) : (
        <table className="admin-table">
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
                  <form action={decideAction} className="inline">
                    <input type="hidden" name="id" value={c.id} />
                    <button type="submit" name="decision" value="approve">
                      {t("approve")}
                    </button>{" "}
                    <button type="submit" name="decision" value="reject">
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
