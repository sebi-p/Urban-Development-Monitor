import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { existsSync } from "node:fs";

// Local dev reads the repo-root .env (shared with packages/db). On Vercel, env comes from the
// project settings and the Neon integration.
const rootEnv = new URL("../../.env", import.meta.url);
if (!process.env.VERCEL && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@mdu/shared", "@mdu/db"],
  // The share image reads its fonts from disk (scripts/copy-assets.mjs copies them).
  // The feeds live at /{city}/feed.xml (PLAN §8) but are API routes: no locale segment.
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/en/:city/feed.xml", destination: "/api/:city/feed/en" },
        { source: "/:city/feed.xml", destination: "/api/:city/feed" },
      ],
    };
  },
  outputFileTracingIncludes: {
    "/[locale]/[city]/proiecte/[slug]/opengraph-image": ["./assets/og-fonts/*.woff"],
  },
};

export default withNextIntl(nextConfig);
