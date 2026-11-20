import { describe, expect, it } from "vitest";
import { SRID } from "./index";

describe("db package", () => {
  it("stores geometry in WGS 84", () => {
    expect(SRID).toBe(4326);
  });
});
