import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Integration tests share one throwaway database per file.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
