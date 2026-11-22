import { adminLogins, isAdmin } from "@/lib/allow-list";

describe("admin allow-list", () => {
  it("matches GitHub logins case-insensitively and ignores spaces", () => {
    expect(adminLogins(" Alice, bob ,,")).toEqual(new Set(["alice", "bob"]));
    expect(isAdmin("ALICE", "alice,bob")).toBe(true);
    expect(isAdmin("carol", "alice,bob")).toBe(false);
  });

  it("lets nobody in without a list or a login", () => {
    expect(isAdmin("alice", "")).toBe(false);
    expect(isAdmin("alice", undefined)).toBe(false);
    expect(isAdmin(null, "alice")).toBe(false);
  });
});
