# ADR 0022: Map filters (neighbourhood, drawn area, near me) and indexing

- Status: accepted
- Date: 2026-11-24
- Milestone: M5.6

## Context

PLAN §8 lists filters the map still lacked: neighbourhood, a drawn area and "near me". The
project pages weren't in any sitemap, so search engines found them only through links. In
OpenStreetMap, Răcădău is named Valea Cetății, which is also the name the site showed, and
residents search for both.

## Decision

- **Neighbourhood.** A "Cartier" select in the filter panel lists the neighbourhoods with
  projects. It is sent as `?cartier=<slug>`, the parameter the feeds already use.
- **Drawn area: a free polygon.** "Desenează zona" loads **terra-draw** (`1.39.0`, MIT, no
  dependencies) and its MapLibre adapter (`1.5.0`) on the first click only, so the 3G budget
  doesn't change.
  - The reader taps the corners and closes the shape on the first one; Enter also closes it and
    Escape cancels.
  - The polygon goes in the URL as `?zona=lon,lat;lon,lat;…`: 3 to 40 corners, five decimals.
  - The database filters with `ST_Intersects` on `ST_MakeValid`, so a self-crossing outline is
    repaired, not refused. Projects with no location are in no area.
  - The feed takes `?zona=` too, and the map links to it ("Flux RSS pentru zonă").
  - Drawing needs a pointer. The neighbourhood select is the keyboard alternative.
- **Near me moves the map only.** On click, the browser is asked for a position. The map flies
  there and shows a dot. The position is never put in the URL, a request or a log: a shared
  link can't reveal where someone lives. The plan's "near me" is met without collecting a
  location.
- **Răcădău.** `config.neighbourhoods.names` (slug → name) shows Valea Cetății as "Valea Cetății
  (Răcădău)". The slug `valea-cetatii`, and so the links, stay. The neighbourhoods stage applies
  the names on every run, including after a redraw.
- **Indexing.** `robots.txt` allows everything except `/admin` and `/api/watchdog`, and points
  to `sitemap.xml`. The sitemap lists the home, about and method pages, each city's map,
  archive and consultations pages, and every published, unmerged project with its last update,
  each with its English alternate. It is read from the database on request, because the build
  has no database (ADR 0003).

## Consequences

- One new client dependency, pinned and loaded on demand.
- Terra-draw's types made MapLibre's GeoJSON types strict in the web app. The API's looser
  project collection is cast where it is handed to MapLibre.
- Official neighbourhood boundaries (PUG units) still replace the approximate areas when the
  town hall sends them (ADR 0017). The `names` entries keep working if the slugs match.
