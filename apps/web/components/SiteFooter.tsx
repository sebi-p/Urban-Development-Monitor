import { Rss } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/** Links to the about and method pages, the city's feed, and the licences (PLAN §8, §11). */
export async function SiteFooter({ city }: { city?: string }) {
  const t = await getTranslations("Site");
  return (
    <footer className="site-footer border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 text-sm text-slate-600">
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          <li>
            <Link href="/despre">{t("about")}</Link>
          </li>
          <li>
            <Link href="/metodologie">{t("method")}</Link>
          </li>
          {city && (
            <li>
              <Link
                href={`/${city}/feed.xml`}
                prefetch={false}
                className="inline-flex items-center gap-1"
              >
                <Rss aria-hidden className="size-3.5" />
                {t("feed")}
              </Link>
            </li>
          )}
        </ul>
        <p className="text-xs text-slate-500">{t("licences")}</p>
      </div>
    </footer>
  );
}
