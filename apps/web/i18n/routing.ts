import { DEFAULT_LOCALE, LOCALES } from "@mdu/shared";
import { defineRouting } from "next-intl/routing";

/**
 * Romanian at `/brasov/...`, English at `/en/brasov/...` (same paths; M4.4, ADR 0017). The
 * browser's language never redirects: a link shared in a Romanian group opens in Romanian.
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "as-needed",
  localeDetection: false,
  alternateLinks: false, // pages declare their own hreflang links in metadata
});
