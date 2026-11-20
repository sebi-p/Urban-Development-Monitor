// Shared enums, zod schemas and i18n keys. The enums from PLAN §6 arrive with the schema in M1.2.

export const DEFAULT_LOCALE = "ro";
export const LOCALES = ["ro", "en"] as const;
export type Locale = (typeof LOCALES)[number];
