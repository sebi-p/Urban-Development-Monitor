import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

/** Locale routing for the public pages (`/en/...`); the API, admin and files are left alone. */
export default createMiddleware(routing);

export const config = {
  matcher: ["/((?!api|admin|_next|_vercel|maplibre|.*\\..*).*)"],
};
