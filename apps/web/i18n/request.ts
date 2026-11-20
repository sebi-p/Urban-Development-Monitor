import { DEFAULT_LOCALE } from "@mdu/shared";
import { getRequestConfig } from "next-intl/server";

// Single locale for now; the ro/en switch and /{city} routing arrive with the public pages (M4).
export default getRequestConfig(async () => {
  const locale = DEFAULT_LOCALE;
  return {
    locale,
    timeZone: "Europe/Bucharest",
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
