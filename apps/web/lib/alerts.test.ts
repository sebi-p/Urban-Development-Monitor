// @vitest-environment node
import { describe, expect, it } from "vitest";
import { syncAlerts } from "./alerts";
import { smokeCheck, smokeReport } from "./smoke";

/** A fake GitHub API: open issues in memory, every call recorded. */
function github(open: { number: number; body: string; pull_request?: object }[]) {
  const calls: string[] = [];
  let next = 100;
  const fetch = async (url: string, init?: RequestInit) => {
    const path = url.replace("https://api.github.com/repos/o/r", "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push(`${init?.method ?? "GET"} ${path}${body?.state ? ` ${body.state}` : ""}`);
    if (path.startsWith("/issues?")) return Response.json(open);
    if (path === "/issues") return Response.json({ number: next++ });
    return Response.json({});
  };
  return { fetch, calls };
}

describe("alert issues", () => {
  it("opens one issue per new problem, comments on a known one, closes the solved ones", async () => {
    const gh = github([
      { number: 7, body: "x\n<!-- mdu-alert:brasov:daily -->" },
      { number: 8, body: "y\n<!-- mdu-alert:pages -->" },
      { number: 9, body: "a person's issue, no marker" },
      { number: 10, body: "<!-- mdu-alert:pages -->", pull_request: {} },
    ]);
    const r = await syncAlerts(
      { repo: "o/r", token: "t", fetch: gh.fetch },
      [
        { key: "brasov:daily", title: "daily missing", detail: "d" },
        { key: "brasov:backfill", title: "night missing", detail: "n" },
      ],
      { closeOthers: true, source: "test" },
    );
    expect(r).toEqual({ opened: [100], commented: [7], closed: [8] });
    expect(gh.calls).toEqual([
      "GET /issues?state=open&per_page=100",
      "POST /issues/7/comments",
      "POST /issues",
      "POST /issues/8/comments",
      "PATCH /issues/8 closed",
    ]);
  });

  it("a workflow alert never closes the others", async () => {
    const gh = github([{ number: 8, body: "<!-- mdu-alert:pages -->" }]);
    const r = await syncAlerts(
      { repo: "o/r", token: "t", fetch: gh.fetch },
      [{ key: "brasov:daily", title: "daily failed", detail: "d" }],
      { source: "ingest-daily" },
    );
    expect(r).toEqual({ opened: [100], commented: [], closed: [] });
  });
});

describe("page checks", () => {
  const site = (broken: string) => async (url: string) => {
    const path = new URL(url).pathname;
    if (path === broken) return new Response("oops", { status: 500 });
    if (path.endsWith(".geojson"))
      return Response.json({
        type: "FeatureCollection",
        features: [{ properties: { slug: "p" } }],
      });
    if (path.endsWith(".xml")) return new Response("<feed>");
    return new Response("<main><h1>x</h1></main>");
  };

  it("checks every page and one project page, and reports only the broken ones", async () => {
    const ok = await smokeCheck("https://x.test", ["c"], { fetch: site("") });
    expect(ok.map((c) => c.path)).toEqual([
      "/",
      "/metodologie",
      "/despre",
      "/c",
      "/c/arhiva",
      "/c/feed.xml",
      "/api/c/projects.geojson",
      "/c/proiecte/p",
    ]);
    expect(smokeReport("https://x.test", ok)).toBe("");
    const bad = await smokeCheck("https://x.test", ["c"], { fetch: site("/c/proiecte/p") });
    expect(smokeReport("https://x.test", bad)).toBe(
      "1 of 8 production checks failed on https://x.test:\n\n- `/c/proiecte/p`: HTTP 500",
    );
  });
});
