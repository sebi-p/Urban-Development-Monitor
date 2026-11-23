import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests (M4.1, ADR 0013) against a production build with the demo data. The map's
 * OpenFreeMap style is replaced by a minimal local one in each test (e2e/fixtures.ts), so runs
 * don't depend on an outside service and the 3G budget measures only our own assets.
 */
const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: "**/budget.e2e.ts" },
    // A mid-range phone, as in Lighthouse's mobile profile.
    { name: "phone", use: { ...devices["Moto G4"] }, testIgnore: "**/budget.e2e.ts" },
    // The 3G timing runs after the others, alone: a parallel worker sharing the CPU would add
    // hundreds of milliseconds to a measurement on a 4x slowed CPU.
    {
      name: "budget",
      use: { ...devices["Moto G4"] },
      testMatch: "**/budget.e2e.ts",
      dependencies: ["desktop", "phone"],
    },
  ],
  webServer: {
    command: process.env.CI ? `pnpm start -p ${PORT}` : `pnpm build && pnpm start -p ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
