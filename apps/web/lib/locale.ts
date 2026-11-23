import { DEFAULT_LOCALE, LOCALES } from "@mdu/shared";
import type { Metadata } from "next";

/** A site path in a locale: Romanian has no prefix, English starts with `/en`. */
export function localePath(locale: string, path: string): string {
  return locale === DEFAULT_LOCALE ? path : `/${locale}${path === "/" ? "" : path}`;
}

/** Canonical and hreflang links for a page that exists in every locale at the same path, and the
 * city's Atom feed when given. */
export function alternates(
  locale: string,
  path: string,
  feed?: { city: string; title: string },
): Metadata["alternates"] {
  return {
    ...(feed
      ? {
          types: {
            "application/atom+xml": [
              { url: localePath(locale, `/${feed.city}/feed.xml`), title: feed.title },
            ],
          },
        }
      : {}),
    canonical: localePath(locale, path),
    languages: {
      ...Object.fromEntries(LOCALES.map((l) => [l, localePath(l, path)])),
      "x-default": path,
    },
  };
}
