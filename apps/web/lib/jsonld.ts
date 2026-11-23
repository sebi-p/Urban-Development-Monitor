import type { ProjectDetail } from "@mdu/db";
import type { BreadcrumbList, DigitalDocument, Place, WebPage, WithContext } from "schema-dts";

/**
 * Structured data for a project page (schema.org, checked at compile time by schema-dts): the
 * page, the place it is about, the official documents it is based on, and the breadcrumbs.
 */
export function projectJsonLd(
  p: ProjectDetail,
  opts: {
    url: string;
    cityUrl: string;
    cityName: string;
    description: string;
    kindLabel: string;
    docLabel: (d: ProjectDetail["documents"][number]) => string;
    breadcrumb: string;
  },
): WithContext<WebPage> {
  const place: Place = {
    "@type": "Place",
    name: p.title,
    ...(p.address
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: p.address,
            addressLocality: opts.cityName,
            addressCountry: "RO",
          },
        }
      : {}),
    ...(p.lon !== null && p.lat !== null
      ? { geo: { "@type": "GeoCoordinates", latitude: p.lat, longitude: p.lon } }
      : {}),
  };
  const documents: DigitalDocument[] = p.documents.map((d) => ({
    "@type": "DigitalDocument",
    name: opts.docLabel(d),
    url: d.url,
    ...(d.date ? { datePublished: d.date } : {}),
  }));
  const breadcrumb: BreadcrumbList = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: opts.cityName, item: opts.cityUrl },
      { "@type": "ListItem", position: 2, name: opts.breadcrumb, item: opts.cityUrl },
      { "@type": "ListItem", position: 3, name: p.title, item: opts.url },
    ],
  };
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": opts.url,
    url: opts.url,
    name: p.title,
    description: opts.description,
    inLanguage: "ro",
    genre: opts.kindLabel,
    dateModified: p.lastCheckedAt,
    about: place,
    ...(documents.length ? { isBasedOn: documents } : {}),
    breadcrumb,
  };
}

/** JSON for a <script type="application/ld+json">: `<` is escaped so text can't close the tag. */
export function jsonLdScript(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
