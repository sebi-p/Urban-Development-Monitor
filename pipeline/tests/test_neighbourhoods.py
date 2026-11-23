"""M4.4: approximate neighbourhoods from OSM place points, official imports, project assignment."""

from typing import Any

import mapbox_vector_tile
import psycopg

from mdu import neighbourhoods as nb
from mdu.core.streets import places_from_tile

BBOX = (25.50, 45.60, 25.70, 45.70)
WEST, EAST, TOWN = (25.55, 45.65), (25.62, 45.65), (25.68, 45.65)


def test_places_come_from_the_tile_place_layer_with_its_buffer() -> None:
    def point(x: int, name: str | None) -> dict[str, Any]:
        props = {"class": "suburb", **({"name": name} if name else {})}
        return {"geometry": f"POINT({x} 100)", "properties": props}

    features = [point(100, "Astra"), point(-50, "Buffer"), point(200, None)]  # no name: skipped
    tile = mapbox_vector_tile.encode([{"name": "place", "features": features}])
    found = places_from_tile(tile, (9300, 5800))
    assert [(n, c) for n, c, _, _ in found] == [("Astra", "suburb"), ("Buffer", "suburb")]


def test_seeds_keep_areas_inside_and_towns_only_as_bounds() -> None:
    inside = lambda p: p[0] < 25.65  # noqa: E731
    places = [
        ("Astra", "suburb", *WEST),
        ("Astra", "suburb", 25.56, 45.66),  # the same name in another tile
        ("Brașov", "city", 25.59, 45.65),  # the city's own centre point: dropped
        ("Săcele", "town", *TOWN),  # a neighbouring town: bounds the cells
        ("Izvor", "suburb", 25.69, 45.66),  # a suburb of that town
    ]
    seeds = nb.seeds_from_places(places, inside, [{"name": "Răcădău", "lon": 25.6, "lat": 45.63}])
    assert [(s.name, s.inside) for s in seeds] == [
        ("Astra", True),
        ("Săcele", False),
        ("Izvor", False),
        ("Răcădău", True),
    ]
    assert (
        nb.slugify("Noua-Dârste / Centrul istoric (Cetatea)")
        == "noua-darste-centrul-istoric-cetatea"
    )


def _jid(pg: psycopg.Connection[Any]) -> int:
    return int(pg.execute("select id from jurisdiction where slug = 'testcity'").fetchone()[0])  # type: ignore[index]


def _project(pg: psycopg.Connection[Any], slug: str, lon: float, lat: float) -> None:
    pg.execute(
        """insert into project (jurisdiction_id, slug, kind, status, title, review_state, geom,
               geom_precision)
           values (%s, %s, 'puz', 'approved', %s, 'auto_published',
                   ST_SetSRID(ST_MakePoint(%s, %s), 4326), 'street')""",
        (_jid(pg), slug, slug, lon, lat),
    )


def _placed(pg: psycopg.Connection[Any]) -> dict[str, str | None]:
    rows = pg.execute(
        """select p.slug, n.slug from project p left join neighbourhood n
           on n.id = p.neighbourhood_id order by p.slug"""
    ).fetchall()
    return {r[0]: r[1] for r in rows}


def test_cells_are_drawn_once_and_projects_assigned(pg: psycopg.Connection[Any]) -> None:
    seeds = [
        nb.Seed("Vest", *WEST, inside=True),
        nb.Seed("Est", *EAST, inside=True),
        nb.Seed("Oraș vecin", *TOWN, inside=False),
    ]
    calls: list[int] = []

    def fetch() -> list[nb.Seed]:
        calls.append(1)
        return seeds

    _project(pg, "near-west", 25.56, 45.64)
    _project(pg, "near-east", 25.63, 45.66)
    _project(pg, "in-the-town", 25.69, 45.65)
    first = nb.run(pg, city="testcity", bbox=BBOX, seeds=fetch)
    assert first.counts["added"] == 2  # the neighbouring town is not a neighbourhood
    assert first.counts["projects_assigned"] == 2
    assert _placed(pg) == {"in-the-town": None, "near-east": "est", "near-west": "vest"}
    # The edge between the cells is halfway between the points.
    edge = pg.execute("""select ST_XMax(geom) from neighbourhood where slug = 'vest'""").fetchone()[
        0
    ]  # type: ignore[index]
    assert abs(edge - (WEST[0] + EAST[0]) / 2) < 1e-9

    again = nb.run(pg, city="testcity", bbox=BBOX, seeds=fetch)
    assert len(calls) == 1  # drawn only when the city had none
    assert again.counts["projects_assigned"] == 0
    assert again.counts["neighbourhoods"] == 2

    # A refresh with one place gone removes its area and unlinks its project.
    nb.run(pg, city="testcity", bbox=BBOX, seeds=lambda: seeds[:1] + seeds[2:], refresh=True)
    # near-east is now past the halfway line to the neighbouring town: in no neighbourhood.
    assert _placed(pg) == {"in-the-town": None, "near-east": None, "near-west": "vest"}


def test_an_official_import_replaces_the_approximate_areas_for_good(
    pg: psycopg.Connection[Any],
) -> None:
    nb.run(pg, city="testcity", bbox=BBOX, seeds=lambda: [nb.Seed("Vest", *WEST, inside=True)])
    _project(pg, "p", 25.56, 45.64)
    square = {
        "type": "Polygon",
        "coordinates": [[[25.5, 45.6], [25.6, 45.6], [25.6, 45.7], [25.5, 45.7], [25.5, 45.6]]],
    }
    collection = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {"DENUMIRE": "UTR Centru"}, "geometry": square},
            {"type": "Feature", "properties": {"DENUMIRE": "Fără formă"}, "geometry": None},
        ],
    }
    r = nb.import_geojson(
        pg, city="testcity", collection=collection, source="pug_unit", name_property="DENUMIRE"
    )
    assert (r.counts["imported"], r.counts["skipped"], r.counts["removed"]) == (1, 1, 1)
    assert _placed(pg) == {"p": "utr-centru"}
    kept = nb.run(
        pg,
        city="testcity",
        bbox=BBOX,
        refresh=True,
        seeds=lambda: [nb.Seed("X", *EAST, inside=True)],
    )
    assert kept.counts["added"] == 0
    assert pg.execute("select boundary_source from neighbourhood").fetchall() == [("pug_unit",)]
