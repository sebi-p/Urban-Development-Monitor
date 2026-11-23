/**
 * The public address of the site, for canonical links, Open Graph and JSON-LD. Vercel sets
 * VERCEL_PROJECT_PRODUCTION_URL (the production domain) on every deployment; NEXT_PUBLIC_SITE_URL
 * overrides it, and local builds fall back to localhost.
 */
export function siteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return new URL(explicit);
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return new URL(`https://${vercel}`);
  return new URL(`http://localhost:${process.env.PORT ?? 3000}`);
}

/** Where readers report mistakes; the same address the collection robot gives site owners. */
export const CONTACT_EMAIL = "urban-development-monitor@pm.me";
