import { MapPin } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";

/** The slim top bar on every page: brand mark, product name, the city, and page actions. */
export async function AppBar({
  city,
  actions,
}: {
  city?: { slug: string; name: string };
  actions?: ReactNode;
}) {
  const t = await getTranslations("Home");
  return (
    <header className="sticky top-0 z-30 flex h-[var(--app-bar-height)] items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur">
      <Link
        href={city ? `/${city.slug}` : "/"}
        className="flex items-center gap-2 text-slate-900 no-underline hover:no-underline"
      >
        <span className="grid size-8 place-items-center rounded-lg bg-accent-700 text-white">
          <MapPin aria-hidden className="size-4.5" strokeWidth={2.5} />
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-semibold">{t("title")}</span>
          {city ? <span className="block text-xs text-slate-500">{city.name}</span> : null}
        </span>
      </Link>
      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </header>
  );
}
