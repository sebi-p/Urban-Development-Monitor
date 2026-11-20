import type { ProjectListItem } from "@mdu/db";
import { PROJECT_KINDS, PROJECT_STATUSES } from "@mdu/shared";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ProjectList } from "@/components/ProjectList";
import en from "@/messages/en.json";
import ro from "@/messages/ro.json";

const item = (
  n: number,
  status: ProjectListItem["status"],
  extra: Partial<ProjectListItem> = {},
): ProjectListItem => ({
  id: `id-${n}`,
  slug: `proiect-${n}`,
  title: `P.U.Z. Proiect ${n}`,
  kind: "puz",
  status,
  address: `Strada Grădinii nr. ${n}`,
  geomPrecision: "street",
  hasLocation: true,
  eventDate: "2026-11-03",
  eventTitle: "Publicat în dezbatere publică",
  sourceUrl: "https://example.test/listing",
  documents: [
    { label: "Proiect de hotărâre", url: `https://example.test/${n}.pdf`, size_bytes: 1000 },
  ],
  ...extra,
});

const renderRo = (ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="ro" messages={ro} timeZone="Europe/Bucharest">
      {ui}
    </NextIntlClientProvider>,
  );

describe("ProjectList", () => {
  it("shows kind, status, date, location note, documents and the official source", () => {
    renderRo(<ProjectList projects={[item(1, "in_public_consultation"), item(2, "approved")]} />);
    expect(screen.getByText("P.U.Z. Proiect 1")).toBeInTheDocument();
    expect(screen.getByText(/PUZ · În consultare publică · 3 nov\. 2026/)).toBeInTheDocument();
    expect(
      screen.getByText(/Strada Grădinii nr\. 1 · locație aproximativă \(strada\)/),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Proiect de hotărâre" })[0]).toHaveAttribute(
      "href",
      "https://example.test/1.pdf",
    );
    expect(screen.getAllByRole("link", { name: "example.test" })[0]).toHaveAttribute(
      "href",
      "https://example.test/listing",
    );
  });

  it("says when a project has no location on the map", () => {
    renderRo(
      <ProjectList projects={[item(3, "approved", { hasLocation: false, address: null })]} />,
    );
    expect(screen.getByText(/Fără adresă identificată · nu apare pe hartă/)).toBeInTheDocument();
  });

  it("says so when there are no projects", () => {
    renderRo(<ProjectList projects={[]} />);
    expect(screen.getByText(ro.City.empty)).toBeInTheDocument();
  });
});

describe("messages", () => {
  const keys = (o: object, prefix = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) =>
      typeof v === "object" ? keys(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
    );

  it("has the same keys in every locale", () => {
    expect(keys(en).sort()).toEqual(keys(ro).sort());
  });

  it("translates every status and project kind", () => {
    for (const m of [ro, en]) {
      expect(Object.keys(m.Status).sort()).toEqual([...PROJECT_STATUSES].sort());
      expect(Object.keys(m.Kind).sort()).toEqual([...PROJECT_KINDS].sort());
    }
  });
});
