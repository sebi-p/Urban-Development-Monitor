import { PROJECT_KINDS, PROJECT_STATUSES } from "@mdu/shared";
import type { ProjectFeature } from "@mdu/db";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ProjectList } from "@/components/ProjectList";
import en from "@/messages/en.json";
import ro from "@/messages/ro.json";

const feature = (n: number, status: ProjectFeature["properties"]["status"]): ProjectFeature => ({
  type: "Feature",
  id: `id-${n}`,
  geometry: { type: "Point", coordinates: [25.6, 45.65] },
  properties: {
    slug: `demo-${n}`,
    title: `[DEMO] Proiect ${n}`,
    kind: "puz",
    status,
    address: `str. Grădinii nr. ${n}`,
    geomPrecision: "address",
  },
});

const renderRo = (ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="ro" messages={ro}>
      {ui}
    </NextIntlClientProvider>,
  );

describe("ProjectList", () => {
  it("lists every project with its translated kind and status", () => {
    renderRo(
      <ProjectList features={[feature(1, "in_public_consultation"), feature(2, "approved")]} />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("[DEMO] Proiect 1")).toBeInTheDocument();
    expect(
      screen.getByText(/PUZ · În consultare publică · str\. Grădinii nr\. 1/),
    ).toBeInTheDocument();
  });

  it("says so when there are no projects", () => {
    renderRo(<ProjectList features={[]} />);
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
