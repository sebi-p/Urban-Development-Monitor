# Monitor Dezvoltare Urbană — Development Plan

Nov 20, 2026 · @Sebastian Pruteanu

## 1. Product summary and scope

Build Monitor Dezvoltare Urbană as a Postgres/PostGIS data pipeline plus a Next.js map site, hosted on free tiers (Neon, Cloudflare R2, Vercel, GitHub Actions). Launch for Brașov with history back to 2020, then extend backwards and to other cities through pluggable source adapters.

**Who it serves:** Brașov residents, neighbourhood associations, journalists and councillors who today must dig through PDFs on brasovcity.ro to learn what is planned next door.

**Product principles**

- **Every fact links to its official source.** Each field, event and summary shows the document it came from, with a fetch date.
- **Plain language first, official detail one click away.** Summaries in Romanian (English second); original PDFs always available.
- **Honest about uncertainty.** AI-extracted fields carry a confidence level; impact figures are labelled as estimates with a method page.
- **Location-agnostic core.** Nothing Brașov-specific in the core schema or UI; city specifics live in a jurisdiction config and its adapters.
- **Polite collection.** Respect robots.txt, throttle requests, cache aggressively, and prefer official exports when the city offers them.

**Scope by release**

| Capability | MVP (v1) | v2 | Later |
| --- | --- | --- | --- |
| Automated collection | PUZ/PUD, council draft decisions in public debate, council agendas and minutes, urbanism notices, CTATU agendas | Building permits (AC) and urbanism certificates (CU) registers, environmental notices, procurement | National Geoportal of Urbanism feed |
| Interactive map | Points/polygons, filters by type, status, date, neighbourhood | Parcel-accurate shapes, heat map of activity | 3D massing |
| Project page | Summary, documents, status, timeline, consultation dates | Corrections from the public, related projects nearby | Discussion/comments |
| Archive search | Full-text + filters, RO/EN | Saved searches | Public API / open data dump |
| Participation | Consultation calendar, "how to submit an observation" box, RSS per neighbourhood | Email alerts per area | Pre-filled observation letters |
| Impact analysis | — | Density, parking, green space estimates | Traffic and services capacity |
| Multi-city | Schema + config ready | Second jurisdiction (e.g. Săcele or Ghimbav) | Any Romanian municipality via adapters |

## 2. Brașov data sources

Almost everything lives on brasovcity.ro as HTML listings pointing to PDFs under predictable `file-zone/` paths, so v1 needs HTML scrapers plus PDF text extraction. The building-permit register sits on an extranet host that disallows crawlers, so permits need the city's permission or a formal data request.

| Source | What it gives | Format and URL pattern | History | Collection method | Priority |
| --- | --- | --- | --- | --- | --- |
| [Council draft decisions in public debate](https://www.brasovcity.ro/file-zone/proiecte/hotarare/PUZJ2025/9.%20Raport%20intocmit%20in%20baza%20legii%2052_2003.pdf) | PUZ/PUD approvals, regulations, infrastructure decisions; debate start/end; Law 52/2003 consultation reports | Listing at `/ro/consiliul_local/proiecte_de_hotarare_dezbatere_publica/<id>/`; files at `/file-zone/proiecte/hotarare/<CODE>/` (proiect de hotărâre, referat, raport de specialitate, memoriu, RLU, planșe) | Files back to at least 2015 ([PMUD 2015](https://www.brasovcity.ro/file-zone/proiecte/hotarare/PMUD/Raport%20general%20dezbatere%20PMUD%2017_12_2015.pdf)) | HTML scraper + PDF parse, daily | P0 |
| [Urbanism and construction hub](https://www.brasovcity.ro/urbanism-si-constructii) | Lists of PUD and PUZ projects with plans; PUG in force (HCL 144/2011) and PUG in preparation; links to CU/AC lookups and city WebGIS | Static page; PUD files under `/file-zone/urbanism/pud/`, PUZ under `/file-zone/urbanism/puz/` | Current items only | HTML scraper, daily | P0 |
| Urbanism notices (`/anunturi`) | PUD/PUZ public-information notices (intent to prepare, consultation windows), traffic committee agendas | HTML listing with a date filter capped at 90 days; attachments often under `/stiri-wp/wp-content/uploads/YYYY/MM/` ([example](https://www.brasovcity.ro/stiri-wp/wp-content/uploads/2025/11/Memo-PUD.pdf)) | Back-fill by sliding 90-day windows | HTML scraper, daily | P0 |
| Council session agendas | Which PUZ/PUD go to vote and when (e.g. 20 Nov 2026 session items 27–35) | `/ro/consiliu/proiect_al_ordinii_de_zi/<id>` (sequential ids; 470 = 20 Nov 2026) and agenda PDFs in [Monitorul Oficial Local](https://www.brasovcity.ro/file-zone/monitorul%20oficial/alte%20documente/ordine-zi-sedinte-consiliu/7.%202025/3.%20Sedinta%20ordinara%20a%20Consiliului%20Local%20al%20Municipiului%20Brasov%20din%2030%20ianuarie%202025.pdf) | Sequential ids allow full back-fill | HTML + PDF, daily | P0 |
| [Council minutes](https://www.brasovcity.ro/file-zone/procese-verbale/consiliu/CMBV-PV-96.pdf) | Votes, amendments (e.g. functions removed from a PUZ), withdrawals | `/file-zone/procese-verbale/consiliu/CMBV-PV-<n>.pdf`, sequential | Back to at least 2013 ([PV 182, Aug 2013](https://www.brasovcity.ro/file-zone/procese-verbale/consiliu/CMBV-PV-182.pdf)) | PDF enumerate + parse, weekly | P1 |
| Adopted decisions (HCL) | Final approval number and date for each PUZ/PUD | Monitorul Oficial Local section (exact listing URL to confirm in Phase 0) | Since the local official gazette started | PDF parse, daily | P0 |
| CTATU and CTC committee agendas | Earliest signal: technical urbanism committee reviews before public debate | PDFs under `/file-zone/urbanism/comisii/ctatu/` | 2026 visible; older to confirm | PDF parse, weekly | P1 |
| CU / AC / certificate-of-completion lookups | Every urbanism certificate and building permit: number, date, applicant, description, address, validity | Search forms on the hub page (years 2005–2026); results served from `extranet.brasovcity.ro`, whose robots.txt blocks crawlers | 2005–present | **Do not scrape.** Ask the city for an export or written permission; file a Law 544/2001 request | P1 (blocked) |
| City WebGIS ([urbanism map](https://serviciiharta.brasovcity.ro/webgis2update/?SiteGuid=7ff2167f-f171-4ca0-8b22-162810a591c5), [PUG proposals map](https://hartapug.brasovcity.ro)) | Approved PUZ/PUD outlines, PUG zoning, green spaces, parking, transit layers | WebGIS app; check whether it exposes WMS/WFS or ArcGIS REST endpoints | Current state | Ask permission, then read the service; never hammer tiles | P1 |
| [ANCPI INSPIRE services](https://inspire-geoportal.ec.europa.eu/srv/api/records/%7B5DCAFDDB-7729-4655-8C5C-845AE8538BFC%7D) | Addresses (RENNS), administrative units, buildings, orthophoto 1:5000 as WMS | Public WMS view services on geoportal.ancpi.ro | Current | Map overlays and address checks; view-only | P2 |
| OpenStreetMap | Streets, buildings, parks, schools, transit stops for geocoding and impact context | Nominatim (max 1 request/second, no bulk on the public server, identify your app per the [usage policy](https://operations.osmfoundation.org/policies/nominatim/)), Overpass extracts | Current | Cached geocoding; nightly Brașov extract | P0 |
| Neighbouring municipalities | PUZ debates in Săcele, Ghimbav and others in the metropolitan area | e.g. [Săcele PUZ PDFs](https://municipiulsacele.ro/documente/2026/urbanism/PUZ-locuinte-Florilor-26-05-2026/documentatie-PUZ-locuinte-Florilor-26-05-2026.pdf), [Ghimbav](https://primaria-ghimbav.ro/storage/2026/03/2026-03-20-Dezb_pub-PUZ-Campus_scolar-Memoriu_prezentare.pdf) | Varies | Second-jurisdiction test (v2) | P2 |
| Environmental agency, public procurement, local news | EIA/SEA screening notices, infrastructure contracts, context links | To be scoped in Phase 0 | Varies | Links and metadata only for news; never copy articles | P2 |

**Legal context that shapes the model.** The new Urban Planning and Construction Code ([Law 169/2026, CATUC](https://economedia.ro/?p=367726)) took effect on 25 August 2026 and [repealed Law 50/1991](https://www.cotidianul.ro/?p=1008105). Procedures started earlier stay under the old rules, so the archive will hold both regimes for years. CATUC also phases in a national one-stop digital desk, [mandatory by August 2031](https://www.forbes.ro/?p=519897), and a [National Geoportal of Urbanism](https://www.revistabiz.ro/geoportalul-national-de-urbanism-si-noile-reguli-din-catuc-ce-trebuie-sa-stie-dezvoltatorii-imobiliari/). That geoportal is the best long-term route to multi-city coverage, so adapters must be swappable.

## 3. Architecture

Split the system into a batch pipeline that writes and a web app that only reads, with Postgres as the single contract between them. The website then stays fast and free to run even when a scraper breaks or an AI quota runs out, and each half can be built and tested by Claude Code on its own.

&#91;embedded content: System architecture · sources, pipeline, storage, web\]

Read top to bottom: adapters pull from each source, four pipeline stages turn documents into project records, R2 keeps the files and Neon keeps the structured data, and the Next.js app serves residents from cached queries. Adding a city means adding adapters and a config file; nothing below the Sources row changes.

## 4. Technology stack

Use TypeScript for everything users touch and Python for collection and document processing, joined only through the Postgres schema. Python has the best PDF, OCR and scraping libraries; Next.js gives server-rendered, indexable project pages and a simple API in one deployable.

| Layer | Choice | Why | Alternative |
| --- | --- | --- | --- |
| Repo | Monorepo, pnpm workspaces (`apps/web`, `packages/db`) + `uv`-managed Python project (`pipeline/`) | One place for schema, docs and CI; Claude Code sees everything | Two repos |
| Database | PostgreSQL 18 + PostGIS 3.6 + `pg_trgm` + `unaccent`, on Neon | Spatial queries, full-text search with the built-in `romanian` config, fuzzy matching of names and addresses | Supabase (smaller free DB, pauses when idle) |
| Schema and migrations | Drizzle ORM + drizzle-kit (TS side); Python reads/writes via SQLAlchemy Core or psycopg against the same tables | Single source of truth in `packages/db`; typed queries in the web app | Prisma; Alembic |
| Web framework | Next.js (App Router, React Server Components), TypeScript strict | SSR/ISR project pages for SEO and sharing; route handlers for the map and search API | SvelteKit; Astro + small API |
| UI | Tailwind CSS + shadcn/ui, lucide icons, `next-intl` (ro default, en) | Fast, accessible components; translations from day one | Mantine |
| Map | MapLibre GL JS + OpenFreeMap vector basemap; GeoJSON endpoint with bbox filters and clustering | No API key or usage limits on the public [OpenFreeMap instance](https://feeds.simonwillison.net/2024/Sep/28/openfreemap/); swap to self-hosted PMTiles on R2 if it ever goes away | Leaflet + OSM raster (heavier usage policy) |
| Search | Postgres full-text (`tsvector`, `romanian` + `unaccent`) + trigram similarity | No extra service to host; good enough for tens of thousands of records | Meilisearch/Typesense later |
| Collection | Python 3.12, `httpx` (HTTP/2, retries), `selectolax` for HTML, Playwright only for pages that need JS | Fast, polite, testable with recorded fixtures | Scrapy |
| Documents | PyMuPDF for text and page images, `pdfplumber` for tables, `ocrmypdf` + Tesseract `ron` for scanned PDFs | Many municipal PDFs are scans; Romanian OCR model handles diacritics | Cloud OCR (paid) |
| AI extraction and summaries | Provider-agnostic `LLMClient` with JSON-schema output; default a free-tier Gemini Flash model, optional Claude Haiku with a monthly spend cap | Free tiers are tight and keep changing (Google cut free Gemini quotas sharply in [late 2025–April 2026](https://agentdeals.dev/gemini-api-pricing-changes)), so cache every call and allow a paid fallback | Local model via Ollama for offline runs |
| Geocoding | Nominatim (cached, 1 request/second), city street list for normalisation, manual geometry editor | Free and allowed for low volumes with caching | Self-hosted Nominatim; commercial geocoder |
| Object storage | Cloudflare R2 (S3 API) for raw HTML/PDF snapshots and extracted text | 10 GB free and [zero egress fees](https://nubbo.app/articles/cloudflare-r2-free-tier/) | Backblaze B2 |
| Scheduling | GitHub Actions cron workflows in a public repo | [Free for public repos](https://docs.github.com/en/actions/reference/usage-limits-billing-and-administration) on standard runners | Cloudflare Cron Triggers calling a webhook |
| Admin auth | Auth.js with GitHub OAuth, allow-list of maintainer accounts | No passwords to store; v1 has no public accounts | Neon Auth / Clerk |
| Alerts (v2) | RSS/Atom per neighbourhood in v1; email via a transactional provider's free tier in v2 | RSS costs nothing and needs no personal data | Telegram/WhatsApp channel bot |
| Quality | Vitest + Playwright (web), pytest + recorded HTTP fixtures (pipeline), Ruff, ESLint, Prettier, mypy | Fixtures let Claude Code test scrapers without hitting the city site | — |
| Observability | Structured JSON logs, a `pipeline_run` table, a free uptime/cron monitor, Sentry free tier | Know when a scraper silently breaks | — |

## 5. Free-tier deployment

The whole v1 runs at $0/month; the only likely paid item is an optional LLM budget (about $5–10/month) to speed up the historic back-fill. The tightest limit is database storage, so full document text lives in R2 and Postgres keeps metadata, extracted fields and search vectors.

| Component | Service and plan | Free allowance that matters | Risk and mitigation |
| --- | --- | --- | --- |
| Database | [Neon Free](https://neon.com/faqs/free-plan-limits-and-quotas) | 1 GB storage and 100 CU-hours per project per month, up to 100 projects (20 GB across all); compute [scales to zero after 5 minutes idle](https://neon.com/faqs/managed-postgres-databases-free-tier); PostGIS available | Storage cap: keep raw text out of Postgres; if needed, split a second Neon project for the document archive. Cold start of a few hundred ms: cache API responses at the CDN |
| Web + API | Vercel Hobby (or Cloudflare Workers via OpenNext) | Hobby is for non-commercial use, which fits a civic project; check current limits before launch | ISR + `Cache-Control: s-maxage` on map/search responses keeps function calls and DB wake-ups low |
| Object storage | [Cloudflare R2](https://nubbo.app/articles/cloudflare-r2-free-tier/) | 10 GB-month, 1M writes and 10M reads per month, free egress | Large plan sheets (planșe) can be tens of MB: store a hash, a page-1 thumbnail and the source URL, and mirror the full file only when it is under a size threshold or linked to an active project |
| Scheduled jobs | GitHub Actions (public repo) | Free standard runners; but [scheduled workflows are disabled after 60 days without repository activity](https://docs.github.com/en/enterprise-server@3.17/actions/learn-github-actions/usage-limits-billing-and-administration) | The pipeline commits a small `status/last-run.json` daily, which keeps the repo active; a cron monitor alerts if a run is missed |
| Basemap | OpenFreeMap public tiles | No keys, no request limits | Public service offered as-is: keep a PMTiles Brașov extract on R2 as fallback |
| Geocoding | Nominatim public server | Max 1 request/second, caching required | Geocode each unique address once; store results permanently |
| Domain and DNS | Cloudflare DNS (free); domain is the only fixed cost (about €10/year for a .ro) | — | — |

**Environments.** `main` deploys to production; every PR gets a Vercel preview wired to a Neon branch (Neon Free allows 10 branches per project), so Claude Code can test migrations against real-shaped data.

**Upgrade path when traffic or data grows.** Neon Launch is pay-as-you-go with no monthly minimum and needs [no data migration](https://neon.com/faqs/postgres-services-free-to-production); R2 overage is cheap; heavy OCR/back-fill jobs can move to a small self-hosted runner. Nothing in the architecture assumes the free tiers, only the cost model does.

## 6. Data model

The core idea: a **project** is a real-world development (a site, a road, a plan) that accumulates **events** over years, and each event cites a **document** fetched from a **source** in a **jurisdiction**. Official identifiers (CU no., AC no., HCL no., land-register CF no.) are stored separately so the linker can join documents that never name each other.

| Entity | Key fields | Notes |
| --- | --- | --- |
| `jurisdiction` | `slug` (`brasov`), name, county, country, `bbox`, timezone, `config` (jsonb: neighbourhood source, street list, legal regime mapping) | Every other table carries `jurisdiction_id`; URLs are `/{jurisdiction}/...` |
| `source` | jurisdiction, `adapter` (e.g. `brasov.council_debates`), base URL, schedule, `enabled`, last success | One row per adapter instance |
| `fetch` / `raw_document` | URL, fetched at, HTTP status, ETag/Last-Modified, `sha256`, MIME, size, `r2_key`, `text_r2_key`, `ocr_used`, `doc_type` (classifier output) | Immutable snapshots; a changed file is a new row with the same URL |
| `project` | slug, title, `kind` (enum), `status` (enum), address text, `geom` (geometry, SRID 4326), `geom_precision` (parcel / address / street / neighbourhood / manual), neighbourhood, initiator (companies and public bodies only), designer, `indicators` jsonb, `summary_ro`, `summary_en`, `legal_regime` (pre/post CATUC), first seen, last changed | The thing users see on the map |
| `project_event` | project, date, `event_type` (enum), document, title, details jsonb, `confidence`, `review_state` | Drives the timeline |
| `identifier` | project, `scheme` (CU, AC, HCL, CF, NR\_CADASTRAL, PUZ\_CODE), value, issued date | Unique on (jurisdiction, scheme, value) |
| `project_document` | project, raw document, `role` (memoriu, RLU, planșă reglementări, raport de specialitate, proiect HCL, HCL, aviz, raport consultare) | Many-to-many |
| `consultation` | project, opens, closes, how to submit (email/address), public meeting date/place | Powers the “open for comments” list |
| `council_session`, `agenda_item` | date, number, item text, outcome (adopted / rejected / withdrawn / postponed), vote counts | Linked to projects via HCL and title matching |
| `neighbourhood` | name, `geom` | Brașov cartiere from OSM or hand-drawn; used for filters and alerts |
| `extraction_run` | raw document, model, prompt version, input hash, output jsonb, tokens, cost | Provenance and cache key for every AI call |
| `correction` | project, field, proposed value, evidence URL, contact (optional), state | Public “report an error” form (v2) |
| `audit_log` | actor, entity, before/after | Every human edit |

**Enums (extensible per legal regime).** `kind`: PUG, PUZ, PUD, CU, AC, AD (demolition), certificate of completion, public infrastructure, regulation, other council decision. `status`: announced → in preparation → in public consultation → under committee review → on council agenda → approved / rejected / withdrawn → permitted → under construction → completed; plus `contested` and `annulled` (court), and `expired` (the public-debate period has ended; the draft goes on to the council). Map CATUC terminology onto the same enums through `jurisdiction.config.legal_regime`.

**`indicators` keys** (all optional, each with `source_document_id` and `confidence`): site area m², POT %, CUT, max height m, regime of height (e.g. P+4+R), main functions, number of dwellings, parking spaces, green space %, setbacks.

```sql
CREATE TABLE project (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id int NOT NULL REFERENCES jurisdiction(id),
  slug text NOT NULL,
  kind project_kind NOT NULL,
  status project_status NOT NULL,
  title text NOT NULL,
  address_text text,
  geom geometry(Geometry, 4326),
  geom_precision geom_precision,
  indicators jsonb NOT NULL DEFAULT '{}',
  summary_ro text, summary_en text,
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('romanian', unaccent_immutable(coalesce(title,''))), 'A') ||
    setweight(to_tsvector('romanian', unaccent_immutable(coalesce(address_text,''))), 'B') ||
    setweight(to_tsvector('romanian', unaccent_immutable(coalesce(summary_ro,''))), 'C')
  ) STORED,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (jurisdiction_id, slug)
);
CREATE INDEX ON project USING gist (geom);
CREATE INDEX ON project USING gin (search);
```

`unaccent_immutable` is a small immutable SQL wrapper around `unaccent`, needed because generated columns require immutable functions; it lets “Racadau” match “Răcădău”.

## 7. Ingestion pipeline

Each run takes a document from discovery to a published project event in eight idempotent stages; every stage reads and writes database state, so a crashed run resumes where it stopped and any stage can be re-run after a prompt or parser change.

1. **Discover.** Each adapter lists candidate URLs (listing pages, sequential ids, date windows) and records them as `pending` fetches. Adapters never parse documents.
2. **Fetch.** Conditional GET with ETag/Last-Modified; skip if the SHA-256 is unchanged; save bytes to R2 under `raw/{jurisdiction}/{yyyy}/{sha256}.{ext}`.
3. **Extract text.** PyMuPDF text layer first; if a page has under \~50 characters of text, run `ocrmypdf -l ron` on it. Save text to R2, keep the first \~8 KB plus headings in Postgres for search.
4. **Classify.** Rules first (file names like `Raport de specialitate`, `Memoriu`, `RLU`, `Proiect de hotarare`), LLM fallback; output `doc_type`.
5. **Extract fields.** Regex for identifiers (`C\.U\. nr\. (\d+)/(\d{2}\.\d{2}\.\d{4})`, `HCL nr\. ?(\d+)/(\d{4})`, `CF (\d+)`), then an LLM call with a strict JSON schema for title, address, initiator, designer, indicators, dates and requested changes. Each value carries the page number it came from.
6. **Link.** Attach to an existing project when any identifier matches; otherwise score candidates by address similarity (trigram), distance, initiator and title; above 0.85 auto-link, 0.6–0.85 goes to the review queue, below creates a new project.
7. **Geocode.** Parcel or CF if available, else normalised street + number via the city street list and Nominatim, else street centroid, else neighbourhood; record `geom_precision`. Reviewers can draw the real outline in the admin map.
8. **Summarise and publish.** Generate a 2–4 sentence Romanian summary (and English) only from extracted fields, with the citation shown under it; publish automatically when confidence is high, otherwise queue for review. Emit feed and alert events.

**Adapter contract** (Python, one module per source under `pipeline/adapters/{jurisdiction}/`):

```python
class SourceAdapter(Protocol):
    key: str                      # "brasov.council_debates"
    jurisdiction: str             # "brasov"
    def discover(self, since: date | None, ctx: RunContext) -> Iterable[DiscoveredItem]: ...
    def backfill_windows(self) -> Iterable[BackfillWindow]: ...   # date ranges or id ranges
    def hints(self, item: DiscoveredItem) -> ItemHints: ...       # doc_type, project title, dates seen on the listing
```

**Politeness rules (enforced in the shared HTTP client, not per adapter):** check robots.txt on every host and refuse disallowed paths; one request every 2–3 seconds per host; big back-fills only between 22:00 and 06:00 Bucharest time; a `User-Agent` naming the project, its URL and a contact email; exponential back-off on 429/5xx; stop the adapter after 20 consecutive errors and alert.

**Schedules.** Daily at 06:30 Bucharest: debates, notices, agendas, hub page. Weekly: minutes, committee PDFs, WebGIS layers. Monthly: re-verify that old URLs still resolve and archive dead ones via the Wayback Machine link.

**LLM cost control.** Cache by `(input_hash, prompt_version, model)` in `extraction_run`; send only the relevant pages (first pages of a memoriu, the indicators table of an RLU), not whole 80-page PDFs; a nightly token budget stops the run cleanly when reached and resumes the next night.

**Testing.** Every adapter ships with saved HTML/PDF fixtures and a golden JSON of expected extraction. CI runs against fixtures only; a separate weekly `live-smoke` workflow fetches one real page per adapter to catch site redesigns.

## 8. Frontend features

The site has four public screens plus an admin area; all are mobile-first, because most residents will arrive from a link shared in a neighbourhood Facebook or WhatsApp group.

| Route | What it does | Key details |
| --- | --- | --- |
| `/{city}` (map, home) | Full-screen MapLibre map with clustered markers and polygons coloured by status; side panel (bottom sheet on mobile) with filters and a result list | Filters: type, status, date range, neighbourhood, “open for comments now”, drawn area. Filter state lives in the URL so any view is shareable. “Near me” uses browser geolocation only on click |
| `/{city}/proiecte/{slug}` | Project page | Plain-language summary with source chip; status badge; key indicators card (height, POT/CUT, dwellings, parking) each linked to its page in the PDF; consultation box with deadline, email and what to write; vertical timeline of events; document list with type, date, size and mirror/original links; mini-map; nearby projects within 500 m; JSON-LD and Open Graph image for sharing |
| `/{city}/arhiva` | Searchable archive | Full-text with highlighted snippets, facets (type, status, year, neighbourhood, initiator), sort by date or relevance, CSV export of results |
| `/{city}/consultari` | Consultation calendar | Everything open for comments, sorted by closing date; past consultations with links to the city's consultation reports |
| `/{city}/feed.xml?cartier=...` | RSS/Atom | New projects and status changes per neighbourhood or drawn area |
| `/despre`, `/metodologie` | About, method, data licence, how AI is used, how to report errors | Required for trust |
| `/admin` | Review queue, project merge/split, geometry editor, source health dashboard, re-run stage for a document | GitHub-login allow-list |

**API (route handlers, all cacheable, read-only):** `GET /api/{city}/projects.geojson?bbox=&kind=&status=&from=&to=`, `GET /api/{city}/projects/{slug}`, `GET /api/{city}/search?q=&page=`, `GET /api/{city}/neighbourhoods.geojson`. Responses carry `s-maxage=300, stale-while-revalidate=3600`. Document the API with an OpenAPI file so it can become the public open-data API later.

**Accessibility and language.** WCAG 2.2 AA; every map result is also reachable as a list; Romanian diacritics in all UI strings; English toggle; dates in Europe/Bucharest.

## 9. Impact analysis (v2, nice to have)

Compute impact numbers deterministically from extracted indicators and open spatial data, then let the LLM only explain those numbers in plain language. This keeps estimates reproducible, auditable and free of invented figures.

| Dimension | Metric shown | How it is computed | Inputs |
| --- | --- | --- | --- |
| Density | Max built floor area; increase vs. what the PUG allows; estimated dwellings and residents | Floor area = CUT × site area; footprint = POT × site area; dwellings = residential floor area ÷ average gross unit size; residents = dwellings × household size; “derogation” = proposed CUT ÷ PUG CUT for that zone | RLU indicators, PUG zoning layer, INS household size (configurable per city) |
| Height and character | Proposed height vs. median height of buildings within 150 m | Compare with OSM `building:levels` / height; flag when more than 2× the median | OSM buildings |
| Parking | Spaces provided vs. spaces required; estimated added cars | Required = dwellings × local norm (configurable, from the local regulation); added cars = dwellings × car ownership rate | RLU, local parking norm, census rate |
| Traffic | Added peak-hour car trips; streets most likely affected | Dwellings × trip rate (configurable); nearest 3 street segments by network distance | OSM road network |
| Green space | Green space % proposed vs. required; green area lost; distance to nearest park | Polygon overlay with OSM/city green-space layers | City green-space WebGIS layer, OSM |
| Services | Schools, kindergartens, clinics, transit stops within 800 m | Count and distance from OSM POIs and transit stops | OSM, public transport stops |
| Cumulative pressure | Other active projects within 500 m / 1 km and their summed dwellings | Spatial join over `project` | Own data |

Every card shows the formula, the inputs with sources, and an “estimate” label; parameters live in `jurisdiction.config.impact` so another city can use its own norms. Never present these as official assessments, and never rank projects as “good” or “bad”.

## 10. Historic back-fill

Launch with 2020–present fully processed, because that window covers the current PUG revision and most projects residents still care about; then extend to 2011 (the PUG in force, HCL 144/2011) in the background after launch.

1. **Inventory first (Phase 0).** Run every adapter in `discover`-only mode across its full range and count URLs, file sizes and scanned-vs-text PDFs. This gives real numbers for storage, OCR time and LLM tokens before anything is downloaded at scale.
2. **Enumerate by structure.** Council agendas by sequential id downward from 470; minutes by `CMBV-PV-<n>`; public-debate pages by id; notices in 90-day windows going back; `file-zone` folders found inside every fetched page.
3. **Recover what was deleted.** Query the Wayback Machine CDX API for `brasovcity.ro/file-zone/*` to find documents no longer linked; store the archive URL as the source and flag it “archived copy”.
4. **Process newest first.** Queue by year descending so the launch window is complete early and later years fill in without blocking.
5. **Budget the slow parts.** Fetch at polite rates overnight; OCR runs in parallel on GitHub runners (6-hour job limit, so shard by year); LLM extraction runs only on documents classified as relevant, under the nightly budget. At free-tier LLM rates of a few hundred requests a day, a large back-fill takes weeks; a one-off paid budget compresses it to days.
6. **Seed what scrapers cannot reach.** The city lookup forms cover permits from 2005, but the register host blocks crawlers. Send a Law 544/2001 request (and a partnership email to the public-information office) for a CSV export of CU/AC since 2015 and for PUZ/PUD outlines from the city GIS; import them through a `manual_import` adapter.
7. **Verify before launch.** Hand-check a random sample of 100 projects against the source PDFs; target at least 95% correct status and 90% correct location to street level, and publish the measured accuracy on `/metodologie`.

## 11. Legal, privacy and trust

The information is public, but republishing it at scale creates obligations; get a short opinion from a Romanian lawyer (GDPR and copyright) before launch. Not legal advice; these are the design defaults to build in.

- **Personal data (GDPR).** Permit and certificate registers list private individuals as applicants. Show names only for companies and public bodies; store individuals as “persoană fizică”. Do not publicly re-host PDFs that contain individuals' personal data; link to the city's copy instead. Run a PII detector (CNP pattern, phone, email, signatures page) before mirroring any file.
- **Copyright.** Official administrative texts (decisions, reports, minutes) can be mirrored. Architect-authored documentation (memorii, planșe) is the designer's work: show a page thumbnail and quote only indicators; link to the original for the full file and keep any full copy private for archival integrity.
- **Scraping etiquette.** Honour robots.txt (it already blocks the permits register), identify the bot, throttle, and stop if the city asks. Aim for a data-sharing agreement; it is the only durable route.
- **Accuracy and right of reply.** Every page shows “last checked” and source links; a “report an error” form; developers and the city can request corrections, handled within 5 working days and logged.
- **Neutrality.** Describe, never campaign. No ranking of projects, no adjectives in summaries, impact figures labelled as estimates.
- **Licences.** Code under AGPL-3.0 or MIT; derived data under CC BY 4.0; OSM-derived layers under ODbL with attribution; basemap attribution visible.
- **Security.** No public accounts in v1; admin via GitHub OAuth allow-list; secrets only in GitHub/Vercel encrypted settings; rate-limit public endpoints; parameterised queries only.

## 12. Roadmap and Claude Code milestones

A public beta with 2020–present data is realistic in about 14 weeks for one part-time developer using Claude Code; each phase ends at a gate with a measurable check, and nothing moves forward until the gate passes.

&#91;embedded content: Roadmap · 7 phases, each closed by a gate\]

The launch phase is highlighted; v2 work starts only after real residents have used the beta.

**Milestones to hand to Claude Code, one per session or PR**

| ID | Task | Done when |
| --- | --- | --- |
| M0.1 | Write `docs/sources/brasov.md`: URL patterns, pagination, sample files for each source in section 2 | Every P0/P1 source has 3–5 saved fixtures and notes |
| M0.2 | `mdu inventory` command: discover-only run that counts URLs, sizes, scanned PDFs per source | CSV report committed under `docs/inventory/` |
| M1.1 | Monorepo scaffold (pnpm, Next.js, uv project, Ruff/ESLint/Prettier, CI) | `pnpm test` and `uv run pytest` pass in CI |
| M1.2 | Drizzle schema for section 6, PostGIS + `unaccent` + `pg_trgm` migration, seed with 10 fake projects | Migration runs on a fresh Neon branch |
| M1.3 | Deploy skeleton: Vercel preview per PR wired to a Neon branch; R2 bucket and keys in secrets | Preview URL shows the seeded projects on a MapLibre map |
| M2.1 | `core/http.py`: robots.txt check, per-host throttle, retries, conditional GET, User-Agent | Unit tests incl. a disallowed path being refused |
| M2.2 | Stage runner + `raw_document` storage to R2 with SHA-256 dedupe | Re-running a stage is a no-op |
| M2.3 | Text extraction with PyMuPDF and OCR fallback (`ocrmypdf -l ron`) | Fixture scans produce readable Romanian text with diacritics |
| M2.4–2.7 | Adapters: `council_debates`, `urbanism_hub`, `notices`, `council_agendas` | Each passes fixture tests; daily workflow runs green |
| M3.1 | Document classifier (rules, LLM fallback) | 95% correct on fixture set |
| M3.2 | Identifier regexes + LLM field extraction with versioned prompt and JSON schema, cached in `extraction_run` | 90% field accuracy on the 50-document golden set |
| M3.3 | Linker (identifier match, then scored candidates) | Golden-set projects merge correctly; ambiguous ones land in review |
| M3.4 | Geocoder with street-list normalisation and permanent cache | 90% of golden-set projects within 100 m |
| M3.5 | Admin: review queue, merge/split, geometry editor, re-run stage | A reviewer can fix a wrong location in under a minute |
| M4.1 | Map page with filters in URL, clustering, list view | Works on a mid-range phone at 3G speed |
| M4.2 | Project page with timeline, documents, consultation box, OG image | JSON-LD validates; share preview shows the summary |
| M4.3 | Archive search with facets and CSV export; list ↔ map highlighting: hovering or focusing a project card highlights its pin on the map (larger, with a ring), and an “Arată pe hartă” button on the card pans and zooms to the pin and opens its popup (on phones it also lowers the sheet so the map is visible; projects without a location show no button) | “Racadau” finds “Răcădău”; results under 300 ms cached; highlighting works with keyboard and touch, and the e2e test checks that the pin is highlighted |
| M4.4 | Consultations page, RSS per neighbourhood, about and method pages, RO/EN; neighbourhood boundaries and the archive's neighbourhood facet (moved from M4.3) | All pages pass axe accessibility checks |
| M5.1 | Back-fill workflow sharded by year with nightly budgets | 2020–present processed |
| M5.2 | Accuracy audit tooling: random sample, side-by-side with source PDF | Audit results published on `/metodologie` |
| M5.3 | Council minutes: outcomes and votes from the minutes PDFs (about 180 since 2020, nearly all with a text layer), so back-filled projects get their actual decision instead of staying “in preparation” (deferred from M5.1). The minutes don't give HCL numbers; those come from the Law 544/2001 export request | Golden-set projects get the right session date, outcome, votes and status |
| M5.4 | Monitoring and alerts: a watchdog that flags a missed or failed daily or back-fill run; `live-smoke.yml` checking the production pages and API after each deploy; a source-health view in admin (last success per adapter, error rates, the alert after 20 consecutive errors); alerts by email or GitHub issue | A missed run, a failed run and a broken production page each raise an alert within a day |
| M5.5 | Fixes from the audit (section 10.7): work through what the first audit finds (status rules, geocoding gaps, filters), review the golden labels left pending from earlier milestones, then run and publish a re-audit | Re-audit published on `/metodologie` with status ≥95% and location ≥90% |
| M5.6 | Launch readiness: `sitemap.xml` and `robots.txt` so project pages are indexed; the map filters from section 8 still missing (neighbourhood, drawn area, “near me”); a Răcădău point, and the official neighbourhood boundaries if the town hall sends them; the lawyer's opinion on GDPR and copyright from section 11 (owner's task, not code) | Sitemap lists every published project; the three filters work on desktop and phone; legal opinion received and acted on |
| M6.x | Permits import, email alerts, corrections, impact analysis, second jurisdiction; second phase of history: Wayback Machine recovery (section 10.3) and the 2011–2019 extension | Per v2 scope in section 1 |

## 13. Repository layout and working with Claude Code

Put this plan in the repo as `docs/PLAN.md`, keep a short `CLAUDE.md` at the root with the rules below, and give Claude Code one milestone task at a time, each ending in a passing test suite and a PR.

```text
monitor-dezvoltare-urbana/
├─ CLAUDE.md                 # conventions, commands, do/don't
├─ docs/
│  ├─ PLAN.md                # this document
│  ├─ adr/                   # architecture decision records (one per choice)
│  └─ sources/brasov.md      # URL patterns, quirks, sample files per source
├─ apps/web/                 # Next.js app (map, project pages, archive, admin, API)
├─ packages/db/              # Drizzle schema, migrations, seed, SQL functions
├─ packages/shared/          # enums, zod schemas, i18n keys shared with the web
├─ pipeline/                 # Python (uv)
│  ├─ core/                  # http client, storage, stages, llm client, geocoder
│  ├─ adapters/brasov/       # one module per source
│  ├─ prompts/               # versioned prompt + JSON schema files
│  └─ tests/fixtures/brasov/ # saved HTML/PDF + golden JSON
├─ config/jurisdictions/brasov.yaml
└─ .github/workflows/        # ci.yml, ingest-daily.yml, ingest-weekly.yml, backfill.yml, live-smoke.yml
```

**`CLAUDE.md` essentials**

- Commands: `pnpm dev`, `pnpm test`, `pnpm db:migrate`, `uv run pytest`, `uv run mdu ingest --adapter brasov.council_debates --dry-run`.
- Never fetch live municipal URLs in tests; add a fixture instead. Live access only through `pipeline/core/http.py`.
- Schema changes only through Drizzle migrations; update `packages/shared` enums in the same PR.
- No Brașov-specific strings outside `adapters/brasov/` and `config/jurisdictions/brasov.yaml`.
- Every extracted value must keep `source_document_id` and page number.
- UI strings only through `next-intl` message files (ro, en).
- Write an ADR for any new dependency or service.

**How to prompt each task.** Reference the milestone ID from section 12, state the acceptance test, and ask for a plan before code on anything touching the schema. Example: “Implement M2.1 `brasov.council_debates` adapter per docs/PLAN.md §2 and §7. Use the fixtures in `tests/fixtures/brasov/debates/`. Done when `uv run pytest -k council_debates` passes and a dry run lists at least 20 items from the fixture listing.”

**Before coding, capture fixtures.** Save 3–5 real examples of each listing page and document type from the city site manually (or in one supervised run) into `tests/fixtures`. This is the single biggest accelerator for AI-assisted scraper work.

## 14. Risks and open questions

The biggest risk is access to permit data, not technology: plan the product so it is useful with council and urbanism documents alone, and treat permits as an upgrade the city may grant.

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Permit/certificate register stays off-limits (robots.txt) | High | Medium | Launch without it; Law 544/2001 request; offer the city a partnership and attribution |
| City redesigns its website | Medium | High | Fixtures + weekly live smoke test; adapters isolated; alerts on zero-result runs |
| Poor PDF quality (scans, rotated plans) | High | Medium | OCR fallback; extraction confidence; review queue; extract only key pages |
| Free tiers change or shrink | Medium | Medium | Provider-agnostic code (S3 API, plain Postgres, pluggable LLM); upgrade costs are small |
| Wrong location or status published | Medium | High | Precision field on every geometry; review threshold; corrections form; sample audit before launch |
| Legal complaint (privacy, copyright) | Low | High | Defaults in section 11; lawyer review; fast takedown process |
| CATUC changes document types and procedures | Certain | Medium | `legal_regime` field and per-regime enum mapping; watch the national geoportal |
| Maintainer burnout (single developer) | Medium | High | Automate review triage; recruit a civic-tech group or local NGO co-maintainer |

**Open questions to settle in Phase 0**

- [ ] Exact URL of the adopted-decisions (HCL) listing in Monitorul Oficial Local, and how far back it goes.
- [ ] Does the city WebGIS expose WMS/WFS or ArcGIS REST endpoints for PUZ/PUD outlines and PUG zoning, and may we use them?
- [ ] Does `/stiri-wp/` expose the WordPress REST API (`/wp-json/wp/v2/`) for notices and media? That would replace HTML scraping for that source.
- [x] Will the city provide a CU/AC export or a data-sharing agreement?
  - [ ] Only what is already publicly on city platforms
- [x] Which neighbourhood boundaries to use (OSM, PUG units, or hand-drawn), and who maintains them?
  - [ ] OSM or PUG Units
  - [x] M4.4: approximate areas around OSM's points; the city's units replace them when it answers (ADR 0017)
- [x] Project name and domain (e.g. `monitor``-``urban.ro`), and the legal entity that publishes it (NGO, informal group, individual).
  - [ ] `monitor-urban.ro`
  - [ ] Initially it will be published anonymously by the "community"
- [x] LLM budget: stay on free tiers only, or allow about $5–10/month for faster back-fill?
  - [ ] $10/mo for the LLM

## Sources

Checked 20 November 2026; service limits change often, so re-verify before launch.

- [Primăria Brașov – Urbanism și construcții hub](https://www.brasovcity.ro/urbanism-si-constructii) (PUD/PUZ lists, CU/AC lookups, WebGIS links, notices, council agenda)
- [Brașov council debate report, PUZ str. Jepilor 2025](https://www.brasovcity.ro/file-zone/proiecte/hotarare/PUZJ2025/9.%20Raport%20intocmit%20in%20baza%20legii%2052_2003.pdf) (debate listing URL pattern)
- [Neon Free plan limits](https://neon.com/faqs/free-plan-limits-and-quotas) and [scale-to-zero](https://neon.com/faqs/managed-postgres-databases-free-tier)
- [Supabase free tier summary](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/) (500 MB, pauses after 7 idle days)
- [Cloudflare R2 free tier](https://nubbo.app/articles/cloudflare-r2-free-tier/)
- [GitHub Actions billing and limits](https://docs.github.com/en/actions/reference/usage-limits-billing-and-administration)
- [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
- [OpenFreeMap](https://openfreemap.org)
- [Gemini API free-tier changes](https://agentdeals.dev/gemini-api-pricing-changes)
- [ANCPI INSPIRE address view service](https://inspire-geoportal.ec.europa.eu/srv/api/records/%7B5DCAFDDB-7729-4655-8C5C-845AE8538BFC%7D)
- [Law 169/2026 (CATUC) entry into force](https://economedia.ro/?p=367726), [one-stop desk timeline](https://www.forbes.ro/?p=519897), [National Geoportal of Urbanism](https://www.revistabiz.ro/geoportalul-national-de-urbanism-si-noile-reguli-din-catuc-ce-trebuie-sa-stie-dezvoltatorii-imobiliari/)
