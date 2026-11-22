import { test as base, type Page } from "@playwright/test";

/** A style with no tiles: the map loads, clusters and pins draw, nothing is fetched outside. */
const STYLE = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#f3f4f6" } }],
};

export async function offlineMap(page: Page): Promise<void> {
  await page.route("https://tiles.openfreemap.org/**", (route) => {
    const url = route.request().url();
    if (url.includes("/styles/")) return route.fulfill({ json: STYLE });
    return route.fulfill({ status: 404, body: "" }); // glyphs: cluster labels just don't draw
  });
}

export const test = base.extend<{ city: string }>({
  city: "brasov",
  page: async ({ page }, provide) => {
    await offlineMap(page);
    await provide(page);
  },
});

export { expect } from "@playwright/test";
