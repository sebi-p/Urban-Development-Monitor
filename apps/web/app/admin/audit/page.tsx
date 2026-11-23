import { listAudits } from "@mdu/db";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { adminLogin } from "@/auth";
import { Button } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { publishAuditAction, startAuditAction } from "../actions";

const CITY = "brasov"; // single city for now, like the rest of /admin

/** Accuracy audits (M5.2): start a sample, follow progress, publish to /metodologie. */
export default async function AuditsPage() {
  if (!(await adminLogin())) return null;
  const t = await getTranslations("Admin");
  const f = await getFormatter();
  const audits = await listAudits(getDb(), CITY);
  return (
    <>
      <nav className="mb-2 text-sm">
        <Link href="/admin">{t("back")}</Link>
      </nav>
      <h2 className="mt-2 mb-1 text-xl font-semibold">{t("auditTitle")}</h2>
      <p className="mb-4 max-w-2xl text-sm text-slate-600">{t("auditIntro")}</p>
      <form action={startAuditAction} className="mb-6 flex flex-wrap items-end gap-3">
        <input type="hidden" name="city" value={CITY} />
        <label className="flex flex-col gap-1 text-sm">
          {t("auditSize")}
          <input
            type="number"
            name="size"
            min={1}
            max={500}
            defaultValue={100}
            className="h-10 w-28 rounded-lg border border-slate-300 bg-white px-2"
          />
        </label>
        <Button type="submit">{t("auditStart")}</Button>
      </form>
      {audits.length === 0 ? (
        <p>{t("auditNone")}</p>
      ) : (
        <ul className="space-y-2">
          {audits.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] bg-white p-3 text-sm shadow-[var(--shadow-card)]"
            >
              <Link href={`/admin/audit/${a.id}/1`} className="font-medium">
                {f.dateTime(new Date(a.createdAt), { dateStyle: "medium", timeStyle: "short" })}
              </Link>
              <span className="text-slate-600">
                {t("auditProgress", { done: a.done, total: a.sampleSize })} · {a.createdBy}
              </span>
              {a.publishedAt ? (
                <span className="ml-auto text-emerald-700">
                  {t("auditPublished", {
                    date: f.dateTime(new Date(a.publishedAt), { dateStyle: "medium" }),
                  })}
                </span>
              ) : (
                <form action={publishAuditAction} className="ml-auto">
                  <input type="hidden" name="auditId" value={a.id} />
                  <Button
                    type="submit"
                    size="sm"
                    variant="secondary"
                    disabled={a.done < a.sampleSize}
                  >
                    {t("auditPublish")}
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
