"use client";

import { Languages } from "lucide-react";
import { useLocale } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { localePath } from "@/lib/locale";

const OTHER = { ro: "en", en: "ro" } as const;
const NAME = { ro: "Română", en: "English" } as const;

/** The same page in the other language, keeping its filters (`?…`) and anchor. The link reads
 * the language's own name ("English", "Română"), marked with its `lang`. */
export function LocaleSwitch() {
  const locale = useLocale() as keyof typeof OTHER;
  const other = OTHER[locale];
  const pathname = usePathname(); // without the locale prefix
  return (
    <a
      href={localePath(other, pathname)}
      hrefLang={other}
      lang={other}
      onClick={(e) => {
        e.currentTarget.href = localePath(other, pathname) + location.search + location.hash;
      }}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-slate-700 no-underline hover:bg-slate-100 hover:no-underline"
    >
      <Languages aria-hidden className="size-4" />
      {NAME[other]}
    </a>
  );
}
