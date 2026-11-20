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
};

export default withNextIntl(nextConfig);
