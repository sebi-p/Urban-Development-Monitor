import type { MapEntry, ProjectListItem } from "@mdu/db";
import { PROJECT_KINDS, PROJECT_STATUSES } from "@mdu/shared";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { LocationNote } from "@/components/project/LocationNote";
import { ProjectList } from "@/components/ProjectList";
import en from "@/messages/en.json";
import ro from "@/messages/ro.json";

const item = (n: number, status: MapEntry["status"], extra: Partial<MapEntry> = {}): MapEntry => ({
  slug: `proiect-${n}`,
  title: `P.U.Z. Proiect ${n}`,
  kind: "puz",
  status,
  address: `Strada Grădinii nr. ${n}`,
  geomPrecision: "street",
  at: [25.6, 45.65],
  date: "2026-11-03",
  years: [2026],
  neighbourhood: null,
  consultations: [],
  initiator: null,
  figures: {},
  ...extra,
});

const renderRo = (ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="ro" messages={ro} timeZone="Europe/Bucharest">
      {ui}
    </NextIntlClientProvider>,
  );

describe("ProjectList", () => {
  it("shows kind, status, date, the location note and a show-on-map button", () => {
    renderRo(
      <ProjectList
        city="oras"
        projects={[item(1, "in_public_consultation"), item(2, "approved")]}
      />,
    );
    expect(screen.getByRole("link", { name: "P.U.Z. Proiect 1" })).toHaveAttribute(
      "href",
      "/oras/proiecte/proiect-1",
    );
    // Status is a badge (icon + label); type and date follow it.
    expect(screen.getAllByText("În consultare publică")[0]).toBeInTheDocument();
    expect(screen.getAllByText(/^PUZ · 3 nov\. 2026$/)[0]).toBeInTheDocument();
    expect(screen.getByText(/Strada Grădinii nr\. 1/)).toBeInTheDocument();
    expect(screen.getAllByText("locație aproximativă (strada)")[0]).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Arată pe hartă" })).toHaveLength(2);
  });

  it("is compact: the documents are on the project page", () => {
    const { container } = renderRo(<ProjectList city="oras" projects={[item(1, "approved")]} />);
    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  it("says when a project has no location on the map", () => {
    renderRo(
      <ProjectList city="oras" projects={[item(3, "approved", { at: null, address: null })]} />,
    );
    expect(screen.getByText(/Fără adresă identificată/)).toBeInTheDocument();
    expect(screen.getByText(/nu apare pe hartă/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Arată pe hartă" })).not.toBeInTheDocument();
  });

  it("says so when there are no projects", () => {
    renderRo(<ProjectList city="oras" projects={[]} />);
    expect(screen.getByText(ro.City.empty)).toBeInTheDocument();
  });

  it("shows the figures and the initiator", () => {
    renderRo(
      <ProjectList
        city="oras"
        projects={[
          item(3, "approved", {
            initiator: "SC ALFA SRL",
            figures: { height_regime: "P+4E", cut: 1.8 },
          }),
        ]}
      />,
    );
    expect(screen.getByText("CUT 1,8")).toBeInTheDocument();
    expect(screen.getByText(/regim de înălțime P\+4E/)).toBeInTheDocument();
    expect(screen.getByText(/Inițiator: SC ALFA SRL/)).toBeInTheDocument();
  });

  it("shows no figure line when nothing was extracted", () => {
    const { container } = renderRo(<ProjectList city="oras" projects={[item(4, "approved")]} />);
    expect(container.querySelector(".indicators")).toBeNull();
  });

  it("says when a reviewer placed the project by hand", () => {
    renderRo(
      <ProjectList city="oras" projects={[item(6, "approved", { geomPrecision: "manual" })]} />,
    );
    expect(screen.getByText("locație stabilită manual")).toBeInTheDocument();
  });
});

describe("LocationNote", () => {
  it("links an exact location to the plan sheet it comes from", () => {
    const sheet = "https://example.test/plansa.pdf";
    const p = {
      geomPrecision: "parcel",
      indicators: {
        location: {
          value: "parcel",
          method: "stereo70 (12 points)",
          source_document_id: "d",
          source_url: sheet,
          page: 1,
          confidence: "high",
        },
      },
    } as unknown as ProjectListItem;
    renderRo(<LocationNote p={p} />);
    expect(screen.getByRole("link", { name: /locație exactă/ })).toHaveAttribute(
      "href",
      `${sheet}#page=1`,
    );
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
