import { listJurisdictions } from "@mdu/db";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const jurisdictions = await listJurisdictions(getDb());
  if (jurisdictions.length === 1) redirect(`/${jurisdictions[0]!.slug}`);

  const t = await getTranslations("Home");
  return (
    <main className="page">
      <h1>{t("title")}</h1>
      <p>{t("tagline")}</p>
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
