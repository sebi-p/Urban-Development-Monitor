"""Geocode stage (PLAN §7 stage 7, M3.4; ADR 0011): the most precise location per project.

1. parcel: the plan's own Stereo 70 boundary coordinates, from the page of its documents with
   the most inventory points (`mdu.core.geo`);
2. address: the street and house number, from OpenStreetMap house numbers (`AddressIndex`);
3. street: what ingestion already set (`geom_precision = "street"`).

A location a reviewer set (`geom_precision = "manual"`) is never changed. The method and the
source page are kept in `project.indicators.location`. Re-running changes nothing.
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import psycopg

from mdu.core.geo import parcel_location, stereo70_pairs
from mdu.core.streets import AddressIndex, StreetIndex, house_number
from mdu.stages import StageResult, TextStore, _log_run

# Where inventories of coordinates appear, best first.
COORDINATE_DOCS = ("plansa_reglementari", "plansa", "studiu", "rlu", "memoriu")
SAME_DEGREES = 1e-6  # about 10 cm


@dataclass(frozen=True)
class Location:
    lon: float
    lat: float
    precision: str  # "parcel" | "address"
    method: str
    raw_document_id: str | None = None
    source_url: str | None = None
    page: int | None = None


def from_documents(
    docs: list[tuple[str, str, str, list[str]]], bbox: tuple[float, float, float, float]
) -> Location | None:
    """docs: (raw_document_id, role, url, page texts). The page with the most usable points."""
    best: tuple[int, int, Location] | None = None
    for doc_id, role, url, pages in docs:
        rank = COORDINATE_DOCS.index(role) if role in COORDINATE_DOCS else len(COORDINATE_DOCS)
        for n, text in enumerate(pages, start=1):
            found = parcel_location(stereo70_pairs(text), bbox)
            if found is None:
                continue
            loc = Location(found.lon, found.lat, "parcel", f"stereo70 ({found.points} points)",
                           doc_id, url, n)  # fmt: skip
            if best is None or (found.points, -rank) > (best[0], -best[1]):
                best = (found.points, rank, loc)
    return best[2] if best else None


def from_address(
    address: str | None, streets: StreetIndex, addresses: AddressIndex
) -> Location | None:
    if not address:
        return None
    street = streets.match(address)
    if street is None:
        return None
    number = house_number(address, street.name)
    point = addresses.get(street.name, number) if number else None
    if point is None:
        return None
    return Location(point[0], point[1], "address", "openstreetmap house number")


def run(  # noqa: PLR0913
    conn: psycopg.Connection[Any],
    store: TextStore,
    *,
    city: str,
    bbox: tuple[float, float, float, float],
    streets: StreetIndex,
    addresses: AddressIndex,
    log: Callable[[str], None] = lambda _: None,
) -> StageResult:
    del log
    result = StageResult()
    row = conn.execute("select id from jurisdiction where slug = %s", (city,)).fetchone()
    if not row:
        raise RuntimeError(f"jurisdiction {city} missing")
    jid = int(row[0])
    projects = conn.execute(
        """select id::text, address_text, geom_precision::text, ST_X(geom), ST_Y(geom),
               indicators->'location'
           from project where jurisdiction_id = %s and merged_into_id is null""",
        (jid,),
    ).fetchall()
    counts: Counter[str] = result.counts
    for pid, address, precision, x, y, current in projects:
        if precision == "manual":
            counts["kept: manual"] += 1
            continue
        with conn.transaction(), conn.cursor() as cur:
            cur.execute(
                """select d.id::text, pd.role::text, d.text_r2_key,
                       (select f.url from "fetch" f where f.raw_document_id = d.id
                        order by f.fetched_at desc nulls last limit 1)
                   from project_document pd join raw_document d on d.id = pd.raw_document_id
                   where pd.project_id = %s and d.text_r2_key is not null
                     and pd.role::text = any(%s)""",
                (pid, list(COORDINATE_DOCS)),
            )
            docs = [
                (
                    doc_id,
                    role,
                    url or "",
                    [p["text"] for p in json.loads(store.get(key)).get("pages") or []],
                )
                for doc_id, role, key, url in cur.fetchall()
            ]
            loc = from_documents(docs, bbox) or from_address(address, streets, addresses)
            if loc is None:
                counts[f"kept: {precision or 'no location'}"] += 1
                continue
            provenance = {
                "value": loc.precision,
                "method": loc.method,
                "source_document_id": loc.raw_document_id,
                "source_url": loc.source_url,
                "page": loc.page,
                "confidence": "high" if loc.precision == "parcel" else "medium",
            }
            same = (
                precision == loc.precision
                and x is not None
                and abs(x - loc.lon) < SAME_DEGREES
                and abs(y - loc.lat) < SAME_DEGREES
                and current == provenance
            )
            if same:
                counts[f"unchanged: {loc.precision}"] += 1
                continue
            cur.execute(
                """update project set geom = ST_SetSRID(ST_MakePoint(%s, %s), 4326),
                       geom_precision = %s,
                       indicators = jsonb_set(indicators, '{location}', %s::jsonb),
                       updated_at = now()
                   where id = %s""",
                (loc.lon, loc.lat, loc.precision, json.dumps(provenance), pid),
            )
            counts[f"set: {loc.precision}"] += 1
    with conn.transaction(), conn.cursor() as cur:
        _log_run(cur, jid, None, "geocode", result)
    return result
