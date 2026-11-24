"""Neighbourhoods (PLAN §5 `neighbourhood`, M4.4; ADR 0017): areas for the archive facet and the
RSS feeds, and each project's neighbourhood.

OpenStreetMap has a named point for most neighbourhoods but, in Brașov, no outlines. Until the
city publishes its own (zoning units), each area is approximated as the Voronoi cell of its point:
everything closer to it than to any other named place. Places in neighbouring towns are seeds
too, so the edge cells stop halfway to them; only places inside the municipality become
neighbourhoods (`boundary_source = "osm"`, shown as approximate). Points OSM lacks can be added
in the jurisdiction config (`config.neighbourhoods.extra`).

`import_geojson` loads official or hand-drawn boundaries (`pug_unit`, `manual`); they replace the
approximate set, and later runs never overwrite them. `assign` gives every located project the
area that contains it. Re-running changes nothing.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any

import psycopg

from mdu.core.http import PoliteClient
from mdu.core.streets import (
    TILEJSON_URL,
    ZOOM,
    Point,
    borders_from_tile,
    fold,
    places_from_tile,
    same_side,
    tile_range,
)
from mdu.stages import StageResult, _log_run

# OpenMapTiles place classes that name a part of a town (or a village inside a municipality).
AREA_CLASSES = frozenset({"suburb", "quarter", "neighbourhood", "village", "hamlet"})
# Whole towns: seeds that bound their neighbours' cells, never areas themselves.
TOWN_CLASSES = frozenset({"city", "town"})
APPROXIMATE = "osm"


@dataclass(frozen=True)
class Seed:
    name: str
    lon: float
    lat: float
    inside: bool  # in the municipality: becomes a neighbourhood


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", fold(name)).strip("-")


def seeds_from_places(
    places: Iterable[tuple[str, str, float, float]],
    inside: Callable[[Point], bool],
    extra: Iterable[dict[str, Any]] = (),
) -> list[Seed]:
    """One seed per name (the first point seen). Towns only bound other cells."""
    seeds: dict[str, Seed] = {}
    for name, cls, lon, lat in places:
        if cls not in AREA_CLASSES | TOWN_CLASSES or name in seeds:
            continue
        here = inside((lon, lat))
        if cls in TOWN_CLASSES and here:
            continue  # the city's own centre point would compete with its neighbourhoods
        seeds[name] = Seed(name, lon, lat, here and cls in AREA_CLASSES)
    for e in extra:
        seeds[str(e["name"])] = Seed(str(e["name"]), float(e["lon"]), float(e["lat"]), True)
    return list(seeds.values())


def fetch_seeds(
    client: PoliteClient,
    bbox: tuple[float, float, float, float],
    *,
    centre: Point | None = None,
    extra: Iterable[dict[str, Any]] = (),
    log: Callable[[str], None] = lambda _: None,
) -> list[Seed]:
    """Place points and municipal borders from the OpenFreeMap tiles (about 60 requests)."""
    template = json.loads(client.get(TILEJSON_URL).content)["tiles"][0]
    places: list[tuple[str, str, float, float]] = []
    borders = []
    tiles = list(tile_range(bbox))
    for i, (x, y) in enumerate(tiles, start=1):
        resp = client.get(template.format(z=ZOOM, x=x, y=y))
        if resp.status == 200 and resp.content:  # noqa: PLR2004
            places += places_from_tile(resp.content, (x, y))
            borders += borders_from_tile(resp.content, (x, y))
        if i % 20 == 0:
            log(f"tiles {i}/{len(tiles)}")
    centre = centre or ((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)
    same = same_side(borders, centre)
    x0, y0, x1, y1 = bbox

    def inside(p: Point) -> bool:
        # Borders are read only within the box, so the side test is meaningless beyond it.
        return x0 <= p[0] <= x1 and y0 <= p[1] <= y1 and same(p)

    seeds = seeds_from_places(places, inside, extra)
    log(f"{sum(s.inside for s in seeds)} neighbourhood points, {len(seeds)} seeds in all")
    return seeds


def _jid(cur: psycopg.Cursor[Any], city: str) -> int:
    cur.execute("select id from jurisdiction where slug = %s", (city,))
    row = cur.fetchone()
    if row is None:
        raise ValueError(f"unknown jurisdiction {city!r}")
    return int(row[0])


def _sources(cur: psycopg.Cursor[Any], jid: int) -> set[str]:
    cur.execute(
        "select distinct boundary_source from neighbourhood where jurisdiction_id = %s", (jid,)
    )
    return {r[0] for r in cur.fetchall()}


def _drop(cur: psycopg.Cursor[Any], jid: int, keep_slugs: list[str] | None = None) -> int:
    """Delete the city's neighbourhoods (except `keep_slugs`), unlinking their projects first."""
    keep = keep_slugs or []
    cur.execute(
        """update project set neighbourhood_id = null
           where neighbourhood_id in (select id from neighbourhood
                                      where jurisdiction_id = %s and not slug = any(%s))""",
        (jid, keep),
    )
    cur.execute(
        "delete from neighbourhood where jurisdiction_id = %s and not slug = any(%s)", (jid, keep)
    )
    return cur.rowcount


def write_cells(
    cur: psycopg.Cursor[Any], jid: int, seeds: list[Seed], bbox: tuple[float, float, float, float]
) -> Counter[str]:
    """Voronoi cells of the seeds inside the bounding box; one row per seed in the municipality.
    Updates only rows whose shape or name changed."""
    counts: Counter[str] = Counter()
    inside = [s for s in seeds if s.inside]
    slugs = [slugify(s.name) for s in seeds]
    cur.execute(
        """
        with pts as (
          select n, s, i, ST_SetSRID(ST_MakePoint(x, y), 4326) as g
          from unnest(%(names)s::text[], %(slugs)s::text[], %(inside)s::bool[],
                      %(xs)s::float8[], %(ys)s::float8[]) as t(n, s, i, x, y)),
        env as (select ST_MakeEnvelope(%(x0)s, %(y0)s, %(x1)s, %(y1)s, 4326) as e),
        cells as (
          select (ST_Dump(ST_VoronoiPolygons(ST_Collect(g), 0, (select e from env)))).geom as c
          from pts
          union all  -- one point has no Voronoi cells: it gets the whole area
          select e from env where (select count(*) from pts) = 1),
        shaped as (
          select p.n, p.s,
                 ST_Multi(ST_CollectionExtract(ST_Intersection(c.c, env.e), 3)) as geom
          from pts p join cells c on ST_Contains(c.c, p.g) cross join env
          where p.i),
        up as (
          insert into neighbourhood (jurisdiction_id, slug, name, geom, boundary_source)
          select %(jid)s, s, n, geom, %(source)s from shaped
          on conflict (jurisdiction_id, slug) do update
            set name = excluded.name, geom = excluded.geom
            where neighbourhood.boundary_source = %(source)s
              and (neighbourhood.name is distinct from excluded.name
                   or not ST_Equals(neighbourhood.geom, excluded.geom))
          returning (xmax = 0) as inserted)
        select inserted, count(*) from up group by inserted
        """,
        {
            "names": [s.name for s in seeds],
            "slugs": slugs,
            "inside": [s.inside for s in seeds],
            "xs": [s.lon for s in seeds],
            "ys": [s.lat for s in seeds],
            "x0": bbox[0], "y0": bbox[1], "x1": bbox[2], "y1": bbox[3],
            "jid": jid,
            "source": APPROXIMATE,
        },
    )  # fmt: skip
    for inserted, n in cur.fetchall():
        counts["added" if inserted else "updated"] += n
    counts["removed"] += _drop(cur, jid, [slugify(s.name) for s in inside])
    return counts


def assign(cur: psycopg.Cursor[Any], jid: int) -> int:
    """Give each located project the (smallest) neighbourhood containing it; unlocated ones none."""
    cur.execute(
        """
        with best as (
          select p.id,
                 (select n.id from neighbourhood n
                  where n.jurisdiction_id = p.jurisdiction_id and p.geom is not null
                    and ST_Covers(n.geom, ST_PointOnSurface(p.geom))
                  order by ST_Area(n.geom) limit 1) as nid
          from project p where p.jurisdiction_id = %s)
        update project p set neighbourhood_id = best.nid
        from best where best.id = p.id and p.neighbourhood_id is distinct from best.nid
        """,
        (jid,),
    )
    return cur.rowcount


def run(  # noqa: PLR0913
    conn: psycopg.Connection[Any],
    *,
    city: str,
    bbox: tuple[float, float, float, float],
    seeds: Callable[[], list[Seed]] | None,
    refresh: bool = False,
    names: dict[str, str] | None = None,
    log: Callable[[str], None] = lambda _: None,
) -> StageResult:
    """Draw the approximate areas when the city has none (or on `refresh`, unless official
    boundaries were imported), then assign projects. `seeds` is called only when drawing.
    `names` (config `neighbourhoods.names`, slug → name) shows a neighbourhood under the name
    people use, keeping its slug and links: "Valea Cetății (Răcădău)" (M5.6)."""
    result = StageResult()
    with conn.transaction(), conn.cursor() as cur:
        jid = _jid(cur, city)
        sources = _sources(cur, jid)
        official = sources - {APPROXIMATE}
        if seeds is not None and not official and (refresh or not sources):
            result.counts.update(write_cells(cur, jid, seeds(), bbox))
        elif official and refresh:
            log(f"keeping imported boundaries ({', '.join(sorted(official))})")
        for slug, name in (names or {}).items():
            cur.execute(
                """update neighbourhood set name = %s
                   where jurisdiction_id = %s and slug = %s and name is distinct from %s""",
                (name, jid, slug, name),
            )
            result.counts["renamed"] += cur.rowcount
        result.counts["projects_assigned"] += assign(cur, jid)
        cur.execute("select count(*) from neighbourhood where jurisdiction_id = %s", (jid,))
        result.counts["neighbourhoods"] = int(cur.fetchone()[0])  # type: ignore[index]
        _log_run(cur, jid, None, "neighbourhoods", result)
    return result


def import_geojson(
    conn: psycopg.Connection[Any],
    *,
    city: str,
    collection: dict[str, Any],
    source: str,
    name_property: str,
) -> StageResult:
    """Replace the city's neighbourhoods with these (Multi)Polygons in WGS 84, then assign."""
    if source == APPROXIMATE:
        raise ValueError(f"{APPROXIMATE!r} is the approximate set; import as pug_unit or manual")
    result = StageResult()
    rows: dict[str, tuple[str, str]] = {}
    for f in collection.get("features", []):
        name = str((f.get("properties") or {}).get(name_property) or "").strip()
        geom = f.get("geometry") or {}
        if not name or geom.get("type") not in ("Polygon", "MultiPolygon"):
            result.counts["skipped"] += 1
            continue
        rows[slugify(name)] = (name, json.dumps(geom))
    if not rows:
        raise ValueError(f"no polygons with a {name_property!r} property")
    with conn.transaction(), conn.cursor() as cur:
        jid = _jid(cur, city)
        result.counts["removed"] += _drop(cur, jid, list(rows))
        for slug, (name, geom) in rows.items():
            cur.execute(
                """insert into neighbourhood (jurisdiction_id, slug, name, geom, boundary_source)
                   values (%s, %s, %s,
                           ST_Multi(ST_CollectionExtract(ST_MakeValid(
                             ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)), 3)), %s)
                   on conflict (jurisdiction_id, slug) do update
                     set name = excluded.name, geom = excluded.geom,
                         boundary_source = excluded.boundary_source""",
                (jid, slug, name, geom, source),
            )
            result.counts["imported"] += 1
        result.counts["projects_assigned"] += assign(cur, jid)
        _log_run(cur, jid, None, "neighbourhoods", result)
    return result
