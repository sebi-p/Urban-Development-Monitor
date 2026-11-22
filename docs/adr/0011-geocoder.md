# ADR 0011: Geocoder, the plans' own coordinates first

- Status: accepted
- Date: 2026-11-22
- Milestone: M3.4

## Context

Until now every pin marked a street: one sample point per street name from the OpenFreeMap tiles (ADR 0005). PLAN §7 stage 7 asks for parcel, then address, then street, then neighbourhood precision, with a permanent cache. The acceptance test is 90% of golden-set projects within 100 m. Nominatim's robots.txt disallows automated search, and the public Overpass servers failed when tried (ADR 0005), so neither is used. Romanian plan sheets and topographic surveys list the boundary of the regulated land as an _inventar de coordonate_ in Stereo 70.

## Decision

- **1. Parcel, from the plan's own coordinates** (`mdu.core.geo`):
  - Pairs of six-digit numbers with two or three decimals are read from the extracted text of the plan sheets, the topographic study, the RLU and the memoriu. Requiring decimals keeps cadastral and register numbers out.
  - They are converted from EPSG:31700 to WGS84 with **pyproj** (3.8, MIT; it bundles PROJ 9).
  - Both column orders are tried, because OCR sometimes swaps them. Points outside the city's bounding box, and those more than 2 km from the median, are dropped. At least 3 points must remain.
  - The location is the centre of the remaining points, from the page with the most points (regulations sheet first). It's stored with that document and page and shown as "locație exactă".
- **2. Address, from OpenStreetMap house numbers:**
  - The `housenumber` layer of the same OpenFreeMap tiles has numbers without street names. Each is given to the nearest named street line within 40 m.
  - The index is built in the same pass over the tiles as the street index (about 60 requests). It's cached permanently in R2 (`cache/addresses/<city>.json`) and rebuilt after 30 days.
  - On 2026-11-22 it held 1,307 house numbers for 800 streets. OSM house-number coverage in Brașov is sparse, and none of the project addresses was in it.
- **3. Street,** as before.
- **A location a reviewer set by hand** (`geom_precision = "manual"`) is never changed.
- **Provenance:** the method, document and page go into `project.indicators.location`. The fields stage leaves that key alone, so neither stage undoes the other.
- **Stage:** `geocode` runs in `mdu daily` after link and fields (`mdu run --stage geocode`). Re-running it changes nothing.
- **No schema change:** `geom_precision` already has `parcel` and `address`.

## Measurements (2026-11-22)

- 12 of the 37 projects have a usable inventory on a plan sheet. They form the golden set (`tests/fixtures/brasov/geocode_golden.json`; texts are private fixtures in R2).
- **Truth:** for each golden project, the centre of its own boundary points. Each was checked to lie along the named street; the church project at the far end of Strada Albinelor is 1.25 km from that street's sample point, from three consecutive inventory points.
- **Result:** parsing and conversion put all 12 within 100 m of the truth. The street-level pins they replace were 37 m to 1.25 km away, and only one was within 100 m.
- **Limitation:** the golden set only covers projects with inventories. For the other 25 projects the location stays at street level, and there's no independent truth to measure it against yet.

## Consequences

- One third of the projects now have their real location, linked to the plan sheet it comes from.
- Better coverage needs more plan sheets with inventories (fetched as documents arrive), city GIS data (permission pending, PLAN §2), or manual placement in the admin (M3.5).
- New dependency: pyproj (MIT), with PROJ data in its wheels.
