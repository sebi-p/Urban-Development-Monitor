# Brașov sources

Findings from M0.1 (2026-11-20). This file updates PLAN §2: several URLs and assumptions there are out of date. Fixtures are listed in `pipeline/tests/fixtures/brasov/manifest.json`; the raw files are in private R2 (`uv run mdu fixtures pull --city brasov`).

Placeholders such as `<project folder>` stand for real path segments. Real folder names are not written here: some contain an applicant's personal name.

## Access rules

| Host                                   | robots.txt                                                                | Status                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `www.brasovcity.ro`                    | None (the URL returns the site's HTML 404 page); pages say `index,follow` | Allowed, throttled to one request per 2.5 s                                                |
| `extranet.brasovcity.ro`               | Disallows `/Registratura/` and many other paths                           | **Never requested.** Listed in `blocked_hosts` in `config/jurisdictions/brasov.yaml`       |
| `serviciiharta.brasovcity.ro` (WebGIS) | None                                                                      | Allowed by robots, but we read nothing beyond the app page until the city agrees (PLAN §2) |
| `www.brasovcity.ro/stiri-wp/wp-json/`  | n/a                                                                       | HTTP 403: the WordPress REST API isn't available                                           |

## Sources

### council_debates: draft decisions in public debate (P0)

- **Listing:** `https://www.brasovcity.ro/consiliul-local/proiecte-de-hotarare-dezbatere-publica`. The URL in PLAN §2 (`/ro/consiliul_local/proiecte_de_hotarare_dezbatere_publica/<id>/`) now returns 404.
- **One page, no pagination.** On 2026-11-20 it listed about 125 project folders with 1,049 file links. Folder codes suggest history back to about 2021.
- **Files:** `/file-zone/proiecte/hotarare/<CODE>/<NN>. <document title>.pdf`. `<CODE>` is a short folder code, such as `PUZ<year>` or a street abbreviation plus year. `<NN>` orders the documents: announcement, draft decision (_proiect de hotărâre_), _referat de aprobare_, _raport de specialitate_, then for urban plans the _memoriu_, regulations and plan sheets (_planșe_), the register of opinions, and the Law 52/2003 consultation report.
- **Link text ends with the file size,** e.g. `[86.94 KB]`. Inventory can read sizes from the listing, without requesting the files.
- **PDFs have a text layer.** All seven sampled had one.
- **Privacy:** the _registru opinii_ (register of opinions) lists the residents who submitted comments. Never mirror it, and extract only counts from it. Plan sheets can reach 10–25 MB; record them by size and don't mirror them (PLAN §5).

### urbanism_hub: urbanism and construction page (P0)

- **Page:** `https://www.brasovcity.ro/urbanism-si-constructii`, with anchors `#proiecte-pud`, `#proiecte-puz`, `#rubrica_anunturi` and `#harta-urbanism`.
- **PUD/PUZ files:** `/file-zone/urbanism/{pud,puz}/<project folder>/<file>.pdf`. On 2026-11-20 there were 57 file links in 14 project folders.
- **Folder names are free text.** Some name the street, some the company, and **some name a private applicant.** Treat folder names as personal data: never publish or commit them, and take project titles from the documents instead.
- **Also on the page:** the current year's committee files (CTATU and CTC), the latest urbanism notices, and the city's WebGIS links.

### notices: announcements (P0)

- **Listing:** `https://www.brasovcity.ro/anunturi`.
- **Articles:** `/detalii-articol/<category>/<slug>/<id>`. `<category>` is `urbanism` or `mediu` (environment), among others. `<id>` is a base64-encoded sequential number, e.g. `Mzc4Mjc` decodes to `37827`. Adapters should key articles on the decoded number, not the slug.
- **Quirk: article pages answer HTTP 404 but still contain the article** (title and attachments). The adapter must accept a 404 for this path and check the content. Checked on three articles (fixtures `notices/*`).
- **Attachments** are on `www` under `/file-zone/...` or `/stiri-wp/wp-content/uploads/YYYY/MM/`.
- **Still to check in M0.2:** PLAN §2's 90-day date filter on the listing, and whether articles can be listed by ID range instead.

### council_agendas: proposed session agendas (P0)

- **URL:** `https://www.brasovcity.ro/consiliu/proiect-al-ordinii-de-zi/<id>`. The old `/ro/consiliu/proiect_al_ordinii_de_zi/<id>` redirects here. ID 470 is the ordinary session of 2026-11-20.
- **The agenda is plain numbered text** in the page body. Every page on the site also has a sidebar widget with the current session's agenda, so the parser must read only the main content.
- **Old IDs don't keep their agendas.** IDs 400 and 300 return HTTP 200 with the page template and no agenda (fixture `council_agendas/session-400`). PLAN §2's assumption that sequential IDs allow a full back-fill doesn't hold. M0.2 measures the range of IDs that still have content.

### council_drafts: draft decisions for sessions (metadata only)

- **Listing:** `https://www.brasovcity.ro/consiliul-local/proiecte-de-hotarare`.
- **Every document link points to `extranet.brasovcity.ro/Registratura/Documente/GetFile.aspx?...`,** which robots.txt disallows. We can use the titles and numbers on the www listing, but never the documents. Public-debate copies of the same drafts (above) are on www.

### council_minutes: session minutes (P1)

- **Listing:** `https://www.brasovcity.ro/consiliul-local/procese-verbale-sedinte/`, with the 18 most recent.
- **Files:** `/file-zone/procese-verbale/consiliu/CMBV-PV-<n>.pdf`. `n` is sequential: 468 is 2026-09-25, 449 is 2025-08-27, and 182 is from 2013.
- **Both sampled minutes (2013 and 2026) have a text layer.** The minutes give votes, amendments and adopted HCL numbers, which partly makes up for the HCL register (below).

### hcl_register: adopted council decisions (P0 in PLAN; blocked)

- **The Monitorul Oficial Local page** `/monitorul-oficial-local/hotararile-autoritatii-deliberative` leads to a search form that POSTs to `/consiliul-local/consultare-registru-hcl`.
- **The form is protected by Cloudflare Turnstile,** a bot challenge. **It isn't automated, and never will be by solving or bypassing the challenge.** This answers PLAN §14's first open question: there's no crawlable HCL listing.
- **Alternatives:** take HCL numbers and dates from the minutes, debate pages and later agendas; and ask the city for an export (Law 544/2001), alongside the permit-register request.

### ctatu: technical urbanism committee (P1)

- **Agendas:** `/file-zone/urbanism/comisii/ctatu/ordine-zi/<N. YYYY>/<YYYYMMDD> - ORDINEA DE ZI CTATU <DD.MM.YYYY>.pdf`.
- **Decisions:** `/file-zone/urbanism/comisii/ctatu/hotarari/<N. YYYY>/<YYYYMMDD>-HOTARARI CTATU <DD.MM.YYYY>.pdf`.
- **Linked from the hub page** for the current year. Older years' folders are still to be checked in M0.2.
- **Decisions can be scanned:** 29.07.2026 has no text layer on any of its 5 pages (fixture `ctatu/decisions-2026-07-29-scanned`, the OCR sample).
- **The traffic committee (CTC)** follows the same pattern under `/file-zone/urbanism/comisii/circulatie/ordine-zi/`. It's out of scope for v1.

### Permits and certificates (CU/AC): blocked

The lookup forms on the hub query `extranet.brasovcity.ro`, which is never requested (PLAN §2, §10.6).

### WebGIS

- **Address:** `https://serviciiharta.brasovcity.ro/webgis2update/?SiteGuid=<guid>`. It's a custom OpenLayers 2 application; each map is a `SiteGuid`.
- **No standard WMS, WFS or ArcGIS REST address is visible on the page.** Layers are configured at runtime by the app's own scripts. Reading those means using an internal API, so we wait for the city's permission (PLAN §2). This answers PLAN §14's second open question as "not exposed publicly as a standard service."

## Answers to the PLAN §14 open questions

| Question                                             | Answer                                                                                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Where is the adopted-decisions (HCL) listing?        | It's a register search form behind Cloudflare Turnstile, so it can't be crawled. Use minutes and agendas, and request an export. |
| Does the WebGIS expose WMS, WFS or ArcGIS REST?      | Not publicly. It's a custom app with runtime configuration, and needs the city's permission.                                     |
| Is the WordPress REST API on `/stiri-wp/` available? | No: HTTP 403. HTML scraping it is.                                                                                               |
