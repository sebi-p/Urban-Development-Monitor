import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

/**
 * M4.4 done criterion: every public page passes axe (WCAG 2.1 A and AA rules), on desktop and
 * phone, in Romanian and English. The map canvas is excluded: MapLibre draws it, and its
 * contents are also in the list.
 */
const PAGES = [
  "/brasov",
  "/brasov/arhiva",
  "/brasov/arhiva?q=demo&tip=puz",
  "/brasov/proiecte/demo-1",
  "/brasov/consultari",
  "/despre",
  "/metodologie",
  "/en/brasov",
  "/en/brasov/proiecte/demo-1",
  "/en/brasov/consultari",
  "/en/despre",
];

for (const path of PAGES) {
  test(`axe: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .exclude(".maplibregl-canvas")
      .analyze();
    const summary = violations.map(
      (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    );
    expect(summary).toEqual([]);
  });
}
