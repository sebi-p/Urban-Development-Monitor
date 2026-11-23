import { Search } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

/** The app bar's way into the archive search (M4.3). */
export async function ArchiveLink({ city }: { city: string }) {
  const t = await getTranslations("Archive");
  return (
    <Link
      href={`/${city}/arhiva`}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:no-underline"
    >
      <Search aria-hidden className="size-4" />
      {t("archiveLink")}
    </Link>
  );
}
