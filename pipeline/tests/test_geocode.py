"""M3.4 acceptance: 90% of golden-set projects within 100 m of their true location."""

import json
from typing import Any

import psycopg

from mdu import geocode
from mdu.core.geo import parcel_location, stereo70_pairs, to_wgs84
from mdu.core.streets import AddressIndex, StreetIndex, StreetPoint, _km
from mdu.fixtures import FixtureSet, fixture_bytes

BRASOV = (25.52, 45.58, 25.68, 45.70)
REQUIRED = 0.90
WITHIN_KM = 0.1


def test_inventory_pairs_need_decimals_and_survive_swapped_columns() -> None:
    table = (
        "Pct X(m) Y(m) | 2001 | 464024.184 | 549428.962 | 2002 464024,732 549433,227 "
        "nr. cad. 141541 46938744"
    )
    assert stereo70_pairs(table) == [(464024.184, 549428.962), (464024.732, 549433.227)]
    lon, lat = to_wgs84(464024.184, 549428.962)
    assert abs(lat - 45.67448) < 1e-4
    assert abs(lon - 25.63453) < 1e-4
    pairs = [(464024.0 + i, 549428.0 + i) for i in range(4)]
    straight = parcel_location(pairs, BRASOV)
    swapped = parcel_location([(y, x) for x, y in pairs], BRASOV)
    assert straight is not None
    assert swapped == straight


def test_outliers_and_points_outside_the_city_are_dropped() -> None:
    near = [(464024.0 + i, 549428.0 + i) for i in range(4)]
    far = [(474024.0, 559428.0)]  # 14 km away, outside the bounding box
    found = parcel_location(near + far, BRASOV)
    assert found is not None
    assert found.points == 4
    assert parcel_location(near[:2], BRASOV) is None  # too few points


def test_golden_set_within_100_m() -> None:
    fs = FixtureSet("brasov")
    golden: dict[str, Any] = json.loads((fs.dir / "geocode_golden.json").read_text())["projects"]
    assert len(golden) >= 10
    hits, street_hits = 0, 0
    for g in golden.values():
        pages = [p["text"] for p in json.loads(fixture_bytes("brasov", g["fixture"]))["pages"]]
        loc = geocode.from_documents([("doc", g["doc_type"], "", pages)], BRASOV)
        truth = tuple(g["truth"])
        hits += loc is not None and _km((loc.lon, loc.lat), truth) <= WITHIN_KM
        street_hits += bool(g["street_pin"]) and _km(tuple(g["street_pin"]), truth) <= WITHIN_KM
    assert hits / len(golden) >= REQUIRED
    assert street_hits < hits  # the street-level pins this replaces were rarely that close


def test_address_from_house_numbers() -> None:
    streets = StreetIndex({"lunga": StreetPoint("Strada Lungă", 25.6, 45.65)})
    addresses = AddressIndex({AddressIndex.key("Strada Lungă", "5A"): (25.601, 45.651)})
    loc = geocode.from_address("Strada Lungă nr. 5a", streets, addresses)
    assert loc is not None
    assert (loc.lon, loc.lat, loc.precision) == (25.601, 45.651, "address")
    assert geocode.from_address("Strada Lungă nr. 7", streets, addresses) is None
    assert geocode.from_address("Strada Lungă", streets, addresses) is None


def test_geocode_stage_sets_parcel_keeps_manual_and_reruns_as_no_op(
    pg: psycopg.Connection[Any],
) -> None:
    class Store:
        def __init__(self) -> None:
            self.objects: dict[str, bytes] = {}

        def get(self, key: str) -> bytes:
            return self.objects[key]

        def put(self, key: str, data: bytes, content_type: str | None = None) -> None:
            self.objects[key] = data

    store = Store()
    table = " ".join(f"{2000 + i} {464024.184 + i:.3f} {549428.962 + i:.3f}" for i in range(5))
    store.put(
        "text/x.json",
        json.dumps({"pages": [{"n": 1, "text": "Plan"}, {"n": 2, "text": table}]}).encode(),
    )
    with pg.transaction(), pg.cursor() as cur:
        for slug, precision in (("p-auto", "street"), ("p-manual", "manual")):
            cur.execute(
                """insert into project (jurisdiction_id, slug, kind, status, title, review_state,
                       geom, geom_precision)
                   values (1, %s, 'puz', 'approved', 'PUZ', 'auto_published',
                       ST_SetSRID(ST_MakePoint(25.62, 45.67), 4326), %s) returning id""",
                (slug, precision),
            )
            pid = cur.fetchone()
            assert pid
            cur.execute(
                """insert into raw_document (jurisdiction_id, url, fetched_at, sha256, mime,
                       size_bytes, doc_type, text_r2_key)
                   values (1, %s, now(), md5(%s) || md5(%s), 'application/pdf', 1,
                       'plansa_reglementari', 'text/x.json') returning id""",
                (f"https://x.test/{slug}.pdf", slug, slug),
            )
            doc = cur.fetchone()
            assert doc
            cur.execute(
                """insert into project_document (jurisdiction_id, project_id, raw_document_id, role)
                   values (1, %s, %s, 'plansa_reglementari')""",
                (pid[0], doc[0]),
            )
    kwargs = {
        "city": "testcity",
        "bbox": BRASOV,
        "streets": StreetIndex({}),
        "addresses": AddressIndex({}),
    }
    first = geocode.run(pg, store, **kwargs)  # type: ignore[arg-type]
    assert first.counts["set: parcel"] == 1
    assert first.counts["kept: manual"] == 1
    row = pg.execute(
        """select geom_precision::text, indicators->'location'->>'page' from project
           where slug = 'p-auto'"""
    ).fetchone()
    assert row == ("parcel", "2")
    manual = pg.execute("select ST_X(geom) from project where slug = 'p-manual'").fetchone()
    assert manual == (25.62,)
    again = geocode.run(pg, store, **kwargs)  # type: ignore[arg-type]
    assert again.counts["unchanged: parcel"] == 1
    assert "set: parcel" not in again.counts
