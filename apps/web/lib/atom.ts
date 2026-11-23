/** Escapes text for XML element content and attribute values. */
export function xml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export interface AtomEntry {
  id: string;
  title: string;
  link: string;
  updated: string; // ISO timestamp
  summary: string;
  category?: string;
}

/** An Atom 1.0 feed (RFC 4287). */
export function atomFeed(feed: {
  id: string;
  title: string;
  self: string;
  link: string;
  updated: string;
  lang: string;
  entries: AtomEntry[];
}): string {
  const entries = feed.entries.map(
    (e) => `  <entry>
    <id>${xml(e.id)}</id>
    <title>${xml(e.title)}</title>
    <link rel="alternate" type="text/html" href="${xml(e.link)}"/>
    <updated>${xml(e.updated)}</updated>${e.category ? `\n    <category term="${xml(e.category)}"/>` : ""}
    <summary type="text">${xml(e.summary)}</summary>
  </entry>`,
  );
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${xml(feed.lang)}">
  <id>${xml(feed.id)}</id>
  <title>${xml(feed.title)}</title>
  <link rel="self" type="application/atom+xml" href="${xml(feed.self)}"/>
  <link rel="alternate" type="text/html" href="${xml(feed.link)}"/>
  <updated>${xml(feed.updated)}</updated>
  <author><name>${xml(feed.title)}</name></author>
${entries.join("\n")}
</feed>
`;
}
