import { runFindings, sourceHealth } from "@mdu/db";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { adminLogin } from "@/auth";
import { getDb } from "@/lib/db";

const CITY = "brasov"; // single city for now, like the rest of /admin

/** Source health (M5.4, ADR 0021): last success, failures and fetch errors per adapter. */
export default async function SourceHealthPage() {
  if (!(await adminLogin())) return null;
  const t = await getTranslations("Admin");
  const f = await getFormatter();
  const db = getDb();
  const [sources, findings] = await Promise.all([sourceHealth(db, CITY), runFindings(db, CITY)]);
  const when = (iso: string | null) =>
    iso ? f.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" }) : t("healthNever");
  return (
    <>
      <nav className="mb-2 text-sm">
        <Link href="/admin">{t("back")}</Link>
      </nav>
      <h2 className="mt-2 mb-1 text-xl font-semibold">{t("healthTitle")}</h2>
      <p className="mb-4 max-w-2xl text-sm text-slate-600">{t("healthIntro")}</p>
      <h3 className="mb-2 font-semibold">{t("healthFindings")}</h3>
      {findings.length === 0 ? (
        <p className="mb-6 text-emerald-700">{t("healthNoFindings")}</p>
      ) : (
        <ul className="mb-6 space-y-2">
          {findings.map((x) => (
            <li
              key={x.key}
              className="rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-3 text-sm"
            >
              <p className="font-medium text-red-800">{x.title}</p>
              <p className="text-slate-700">{x.detail}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse overflow-hidden rounded-[var(--radius-card)] bg-white text-sm shadow-[var(--shadow-card)] [&_td]:border-b [&_td]:border-slate-100 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-slate-600">
          <thead>
            <tr>
              <th>{t("healthAdapter")}</th>
              <th>{t("healthLastSuccess")}</th>
              <th>{t("healthFailures")}</th>
              <th>{t("healthFetchErrors")}</th>
              <th>{t("healthLastError")}</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.adapter} className={s.stopped ? "bg-red-50" : undefined}>
                <td className="font-medium">
                  {s.adapter}
                  {s.stopped ? (
                    <span className="ml-2 text-xs text-red-700">{t("healthStopped")}</span>
                  ) : null}
                </td>
                <td>{when(s.lastSuccess)}</td>
                <td>
                  {s.failed7d} / {s.failed30d}
                </td>
                <td>
                  {s.fetches7d
                    ? `${s.fetchErrors7d} / ${s.fetches7d} (${f.number(s.fetchErrors7d / s.fetches7d, { style: "percent" })})`
                    : "–"}
                </td>
                <td className="max-w-md break-words text-slate-600">
                  {s.lastError ? `${when(s.lastFailure)}: ${s.lastError.slice(0, 300)}` : "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
