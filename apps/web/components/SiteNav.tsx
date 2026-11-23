import { CalendarClock, Map as MapIcon, Search } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export type Section = "map" | "archive" | "consultations" | "other";

/** The app bar's sections: map, archive, consultations. Phones show the icons; the current
 * section is marked (`aria-current`) and not repeated as a link. */
export async function SiteNav({ city, current }: { city: string; current: Section }) {
  const t = await getTranslations("Site");
  const items = [
    { key: "map", href: `/${city}`, label: t("map"), Icon: MapIcon },
    { key: "archive", href: `/${city}/arhiva`, label: t("archive"), Icon: Search },
    {
      key: "consultations",
      href: `/${city}/consultari`,
      label: t("consultations"),
      Icon: CalendarClock,
    },
  ] as const;
  return (
    <nav aria-label={t("sections")}>
      <ul className="flex items-center">
        {items.map(({ key, href, label, Icon }) => (
          <li key={key}>
            <Link
              href={href}
              aria-current={key === current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:no-underline sm:px-3",
                key === current && "bg-accent-50 text-accent-800",
              )}
            >
              <Icon aria-hidden className="size-4" />
              <span className="sr-only sm:not-sr-only">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
