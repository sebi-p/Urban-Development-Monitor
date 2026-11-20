export * from "./enums.ts";
export * from "./indicators.ts";

export const DEFAULT_LOCALE = "ro";
export const LOCALES = ["ro", "en"] as const;
export type Locale = (typeof LOCALES)[number];
