import { listJurisdictions } from "@mdu/db";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const jurisdictions = await listJurisdictions(getDb());
  if (jurisdictions.length === 1) redirect({ href: `/${jurisdictions[0]!.slug}`, locale });

  const t = await getTranslations("Home");
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-2 text-3xl font-semibold">{t("title")}</h1>
      <p className="mb-4 text-slate-600">{t("tagline")}</p>
      {jurisdictions.length === 0 ? (
        <p>{t("noCities")}</p>
      ) : (
        <ul>
          {jurisdictions.map((j) => (
            <li key={j.slug}>
              <Link href={`/${j.slug}`}>{j.name}</Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
