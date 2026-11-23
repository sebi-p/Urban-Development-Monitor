import { expect, test } from "./fixtures";

/** M4.4: consultations, feeds, neighbourhoods, about and method pages, and the English site. */

test("the consultations page lists the open one with its deadline and email", async ({
  page,
  city,
}) => {
  await page.goto(`/${city}/consultari`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Consultări publice");
  const open = page.locator(".open-list > li[data-state=open]");
  await expect(open).toHaveCount(1);
  await expect(open.locator(".days-left")).toContainText(/Mai (sunt|este) \d+/);
  await expect(open.getByRole("link", { name: "registratura@example.org" })).toHaveAttribute(
    "href",
    "mailto:registratura@example.org",
  );
  await open.getByRole("link", { name: /\[DEMO\] PUZ locuințe colective/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${city}/proiecte/demo-1$`));
});

test("the city and neighbourhood feeds are Atom, and an unknown area is a 404", async ({
  page,
  city,
}) => {
  const all = await page.request.get(`/${city}/feed.xml`);
  expect(all.status()).toBe(200);
  expect(all.headers()["content-type"]).toContain("application/atom+xml");
  const xml = await all.text();
  expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="ro">');
  expect(xml).toContain("Proiect nou: [DEMO]");
  const entries = (s: string) => s.match(/<entry>/g)?.length ?? 0;
  const west = await (await page.request.get(`/${city}/feed.xml?cartier=demo-vest`)).text();
  expect(west).toContain("[DEMO] Vest</title>");
  expect(entries(west)).toBeGreaterThan(0);
  expect(entries(west)).toBeLessThan(entries(xml));
  expect((await page.request.get(`/${city}/feed.xml?cartier=nicaieri`)).status()).toBe(404);
  const en = await (await page.request.get(`/en/${city}/feed.xml`)).text();
  expect(en).toContain('xml:lang="en"');
  expect(en).toContain("New project: [DEMO]");
  // Readers find the feed from the map page.
  await page.goto(`/${city}`);
  await expect(page.locator('link[rel=alternate][type="application/atom+xml"]')).toHaveAttribute(
    "href",
    new RegExp(`/${city}/feed.xml$`),
  );
});

test("the archive filters by neighbourhood", async ({ page, city }) => {
  await page.goto(`/${city}/arhiva`);
  await expect(page.getByText("Zone aproximative, după OpenStreetMap")).toBeVisible();
  await page.getByRole("checkbox", { name: /^\[DEMO\] Vest/ }).check();
  await expect(page).toHaveURL(/cartier=demo-vest/);
  const hits = page.locator(".results > li");
  await expect(hits.first()).toBeVisible();
  for (const text of await hits.allTextContents()) expect(text).toContain("[DEMO] Vest");
  const geo = await page.request.get(`/api/${city}/neighbourhoods.geojson`);
  expect(geo.headers()["content-type"]).toContain("application/geo+json");
  const body = (await geo.json()) as { features: { properties: { slug: string } }[] };
  expect(body.features.map((f) => f.properties.slug)).toEqual(
    expect.arrayContaining(["demo-est", "demo-vest"]),
  );
});

test("the about and method pages, in both languages", async ({ page }) => {
  await page.goto("/despre");
  await expect(page.locator("html")).toHaveAttribute("lang", "ro");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Despre Monitor Dezvoltare Urbană",
  );
  await expect(page.getByRole("link", { name: "CC BY 4.0" })).toBeVisible();
  await expect(page.locator('link[rel=alternate][hreflang="en"]')).toHaveAttribute(
    "href",
    /\/en\/despre$/,
  );
  await page.getByRole("link", { name: "Metodologie" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cum lucrăm");
  await page.goto("/en/metodologie");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How we work");
});

test("the language switch keeps the page and its filters", async ({ page, city }, info) => {
  test.skip(info.project.name !== "desktop", "the same link on phones");
  await page.goto(`/${city}?tip=puz`);
  await expect(page.locator("html")).toHaveAttribute("lang", "ro");
  await page.getByRole("link", { name: "English", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/en/${city}\\?tip=puz$`));
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("checkbox", { name: "Zonal urban plan (PUZ)" })).toBeChecked();
  // Links stay in English; the project page shows the English summary when there is one.
  await page.locator(".project-list > li#p-demo-1").getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`/en/${city}/proiecte/demo-1$`));
  await expect(page.getByRole("heading", { name: "In short" })).toBeVisible();
  await page.getByRole("link", { name: "Română", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${city}/proiecte/demo-1$`));
  await expect(page.locator("html")).toHaveAttribute("lang", "ro");
});
