import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, LOCALES } from "./index";

describe("locales", () => {
  it("defaults to Romanian and includes English", () => {
    expect(DEFAULT_LOCALE).toBe("ro");
    expect(LOCALES).toContain("en");
  });
});
