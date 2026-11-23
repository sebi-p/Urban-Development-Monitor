"""Street-level geocoding from OpenStreetMap street names (PLAN §7 stage 7, first slice).

Street names and geometry come from the same OpenFreeMap vector tiles the web map uses
(OpenMapTiles schema, layer `transportation_name`): about 60 zoom-14 tiles cover a city, and
OpenFreeMap has no usage limits. Street mentions in titles ("str. Lungă nr. 5",
"B-dul Griviței f.n.") are matched locally, so no per-address geocoding requests are made.

Not used: Nominatim (its robots.txt disallows automated search) and the public Overpass
instances (refused or timed out during testing, 2026-11-20). Streets outside the municipality
(neighbouring towns inside the bounding box) are dropped using the tiles' administrative border
lines, so a name shared with another town can't place a project there. Results are approximate
(`geom_precision = "street"`). Street data © OpenStreetMap contributors (ODbL), OpenMapTiles.
"""

from __future__ import annotations

import itertools
import json
import math
import re
import unicodedata
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass

import mapbox_vector_tile

from mdu.core.http import PoliteClient

TILEJSON_URL = "https://tiles.openfreemap.org/planet"
ZOOM = 14
CLUSTER_KM = 1.5  # segments of one street closer than this belong together

# Street-type words, normalised (no diacritics, lower case, no dots).
_TYPES = (
    "strada", "str", "bulevardul", "bdul", "b-dul", "bd", "calea", "aleea", "al", "piata",
    "p-ta", "pta", "soseaua", "sos", "splaiul", "intrarea", "intr", "drumul", "fundatura",
)  # fmt: skip
_TYPE_RE = "|".join(sorted((re.escape(t) for t in _TYPES), key=len, reverse=True))
# A mention ends at a house number, "f.n." (no number), punctuation or the end of the text.
_MENTION = re.compile(
    rf"\b(?:{_TYPE_RE})\.?\s*(.+?)"
    r"(?=\s+(?:nr\.?|numarul|f\.?\s?n\.?|fn)\b|\s*[,;:()\"„”“]|\s+-\s|$)",
    re.I,
)
_LEADING_TYPE = re.compile(rf"^(?:{_TYPE_RE})\.?\s+", re.I)


def fold(text: str) -> str:
    """Lower case without diacritics; cedilla and comma forms of ș/ț fold the same way."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower()


def normalize(name: str) -> str:
    """'Strada Mihai Viteazul' / 'str. Mihai Viteazul' -> 'mihai viteazul'."""
    s = _LEADING_TYPE.sub("", fold(name).strip())
    s = re.sub(r"[^\w\s]", " ", s.replace("-", " "))
    return re.sub(r"\s+", " ", s).strip()


# A house number directly after the street name ("str. Lungă nr. 5", "Calea X, nr. 35A"); other
# numbers in a text ("CU nr 2456/2022", "HCL nr. 198") are not addresses.
_NUMBER_AFTER_STREET = re.compile(r"\s*,?\s*(?:nr\.?|numarul)\s*(\d+[a-z]?)\b")


def house_number(text: str, street_name: str) -> str | None:
    """'35A' from '... Calea Feldioarei nr. 35a ...' given the street 'Calea Feldioarei'."""
    folded = fold(text)
    words = normalize(street_name).split()
    if not words:
        return None
    for hit in re.finditer(rf"\b{re.escape(words[-1])}\b", folded):
        m = _NUMBER_AFTER_STREET.match(folded, hit.end())
        if m:
            return m.group(1).upper()
    return None


@dataclass(frozen=True)
class StreetPoint:
    name: str
    lon: float
    lat: float


Point = tuple[float, float]


def _km(a: Point, b: Point) -> float:
    dx = (a[0] - b[0]) * 111.32 * math.cos(math.radians((a[1] + b[1]) / 2))
    dy = (a[1] - b[1]) * 110.57
    return math.hypot(dx, dy)


def _mean(points: list[Point]) -> Point:
    return (sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points))


def _clusters(points: list[Point]) -> list[list[Point]]:
    """Single-linkage clusters at CLUSTER_KM (a few dozen points per name at most)."""
    remaining = list(points)
    out = []
    while remaining:
        cluster = [remaining.pop()]
        grew = True
        while grew:
            grew = False
            for p in list(remaining):
                if any(_km(p, q) <= CLUSTER_KM for q in cluster):
                    cluster.append(p)
                    remaining.remove(p)
                    grew = True
        out.append(cluster)
    return out


class StreetIndex:
    def __init__(self, points: dict[str, StreetPoint]) -> None:
        self.points = points

    def __len__(self) -> int:
        return len(self.points)

    @classmethod
    def from_segments(
        cls,
        segments: Iterable[tuple[str, float, float]],
        centre: Point,
        inside: Callable[[Point], bool] | None = None,
    ) -> StreetIndex:
        """One point per street name from (name, lon, lat) samples along its segments.

        The same name can exist in a neighbouring town inside the bounding box, so samples are
        clustered and the cluster nearest the city centre wins. The point is the sample nearest
        that cluster's mean, which lies on the street (the mean itself may not)."""
        by_name: dict[str, tuple[str, list[Point]]] = {}
        for name, lon, lat in segments:
            if inside is None or inside((lon, lat)):
                by_name.setdefault(normalize(name), (name, []))[1].append((lon, lat))
        points = {}
        for key, (name, samples) in by_name.items():
            if not key:
                continue
            best = min(_clusters(samples), key=lambda c: _km(_mean(c), centre))
            mean = _mean(best)
            lon, lat = min(best, key=lambda p: _km(p, mean))
            points[key] = StreetPoint(name, round(lon, 6), round(lat, 6))
        return cls(points)

    def to_json(self) -> str:
        data = {k: asdict(v) for k, v in sorted(self.points.items())}
        return json.dumps(data, ensure_ascii=False)

    @classmethod
    def from_json(cls, text: str) -> StreetIndex:
        return cls({k: StreetPoint(**v) for k, v in json.loads(text).items()})

    def mentions(self, text: str) -> list[str]:
        return [m.group(1).strip() for m in _MENTION.finditer(fold(text))]

    def match(self, text: str) -> StreetPoint | None:
        """First street mentioned in `text` that exists in the index. Tries the full mention,
        then shorter prefixes ('mihai viteazul bloc 3' -> 'mihai viteazul')."""
        for mention in self.mentions(text):
            words = normalize(mention).split()
            for n in range(len(words), 0, -1):
                hit = self.points.get(" ".join(words[:n]))
                if hit:
                    return hit
        return None


# Vector tiles


def tile_range(
    bbox: tuple[float, float, float, float], zoom: int = ZOOM
) -> Iterable[tuple[int, int]]:
    min_lon, min_lat, max_lon, max_lat = bbox
    n = 2**zoom

    def tx(lon: float) -> int:
        return int((lon + 180) / 360 * n)

    def ty(lat: float) -> int:
        return int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)

    for x in range(tx(min_lon), tx(max_lon) + 1):
        for y in range(ty(max_lat), ty(min_lat) + 1):
            yield x, y


def _to_lonlat(tile: tuple[int, int], px: float, py: float, extent: int) -> Point:
    n = 2**ZOOM
    lon = (tile[0] + px / extent) / n * 360 - 180
    # mapbox_vector_tile returns y with the origin at the bottom of the tile by default.
    merc_y = tile[1] + (extent - py) / extent
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * merc_y / n))))
    return lon, lat


def segments_from_tile(data: bytes, tile: tuple[int, int]) -> list[tuple[str, float, float]]:
    """(name, lon, lat) at the middle vertex of every named street line in one tile."""
    layer = mapbox_vector_tile.decode(data).get("transportation_name")
    if not layer:
        return []
    extent = layer.get("extent", 4096)
    out = []
    for feature in layer["features"]:
        name = feature["properties"].get("name")
        geom = feature["geometry"]
        if not name or geom["type"] not in ("LineString", "MultiLineString"):
            continue
        lines = [geom["coordinates"]] if geom["type"] == "LineString" else geom["coordinates"]
        for line in lines:
            if line:
                px, py = line[len(line) // 2]
                out.append((name, *_to_lonlat(tile, px, py, extent)))
    return out


def places_from_tile(data: bytes, tile: tuple[int, int]) -> list[tuple[str, str, float, float]]:
    """(name, class, lon, lat) of every named place point in one tile: city, town, village,
    suburb, quarter, neighbourhood… (OpenMapTiles `place` layer; points only, no outlines)."""
    layer = mapbox_vector_tile.decode(data).get("place")
    if not layer:
        return []
    extent = layer.get("extent", 4096)
    out = []
    for feature in layer["features"]:
        props, geom = feature["properties"], feature["geometry"]
        name = props.get("name")
        if not name or geom["type"] != "Point":
            continue
        # Points in the tile's buffer are kept: at the edge of the area they are the only way to
        # see the next town. Callers drop repeats by name.
        px, py = geom["coordinates"]
        out.append((name, str(props.get("class")), *_to_lonlat(tile, px, py, extent)))
    return out


Segment = tuple[Point, Point]


def _clip(a: Point, b: Point, size: float) -> tuple[Point, Point] | None:
    """Liang–Barsky clip of segment a-b to the square [0, size]². Tiles carry a buffer beyond
    their edges, so unclipped border lines would be counted twice by neighbouring tiles."""
    t0, t1 = 0.0, 1.0
    dx, dy = b[0] - a[0], b[1] - a[1]
    for p, q in ((-dx, a[0]), (dx, size - a[0]), (-dy, a[1]), (dy, size - a[1])):
        if p == 0:
            if q < 0:
                return None
            continue
        r = q / p
        if p < 0:
            t0 = max(t0, r)
        else:
            t1 = min(t1, r)
        if t0 > t1:
            return None
    return (a[0] + t0 * dx, a[1] + t0 * dy), (a[0] + t1 * dx, a[1] + t1 * dy)


def borders_from_tile(data: bytes, tile: tuple[int, int], max_level: int = 8) -> list[Segment]:
    """Administrative border segments (municipality level or higher) inside one tile."""
    layer = mapbox_vector_tile.decode(data).get("boundary")
    if not layer:
        return []
    extent = layer.get("extent", 4096)
    out = []
    for feature in layer["features"]:
        props, geom = feature["properties"], feature["geometry"]
        if props.get("maritime") or (props.get("admin_level") or 99) > max_level:
            continue
        lines = [geom["coordinates"]] if geom["type"] == "LineString" else geom["coordinates"]
        for line in lines:
            for a, b in itertools.pairwise(line):
                clipped = _clip((float(a[0]), float(a[1])), (float(b[0]), float(b[1])), extent)
                if clipped:
                    out.append(
                        (
                            _to_lonlat(tile, *clipped[0], extent),
                            _to_lonlat(tile, *clipped[1], extent),
                        )
                    )
    return out


def _crosses(p: Point, q: Point, s: Segment) -> bool:
    def orient(a: Point, b: Point, c: Point) -> float:
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    a, b = s
    return (orient(p, q, a) > 0) != (orient(p, q, b) > 0) and (orient(a, b, p) > 0) != (
        orient(a, b, q) > 0
    )


def same_side(borders: list[Segment], centre: Point) -> Callable[[Point], bool]:
    """Point-in-municipality test: the line from a point to the city centre crosses borders an
    even number of times exactly when both lie in the same municipality."""

    def inside(p: Point) -> bool:
        return sum(_crosses(p, centre, s) for s in borders) % 2 == 0

    return inside


# House numbers (M3.4): the tiles' `housenumber` layer has points with a number but no street, so
# each number is given to the nearest named street line within ADDRESS_MAX_M.
ADDRESS_MAX_M = 40.0


def _point_segment_px(p: Point, a: Point, b: Point) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    if dx == dy == 0:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))


def addresses_from_tile(data: bytes, tile: tuple[int, int]) -> list[tuple[str, str, float, float]]:
    """(street name, house number, lon, lat) for the tile's numbered buildings."""
    layers = mapbox_vector_tile.decode(data)
    numbers, names = layers.get("housenumber"), layers.get("transportation_name")
    if not numbers or not names:
        return []
    extent = numbers.get("extent", 4096)
    lat_mid = _to_lonlat(tile, extent / 2, extent / 2, extent)[1]
    metres_per_px = 40_075_016.686 * math.cos(math.radians(lat_mid)) / 2**ZOOM / extent
    lines = []
    for f in names["features"]:
        name, geom = f["properties"].get("name"), f["geometry"]
        if not name or geom["type"] not in ("LineString", "MultiLineString"):
            continue
        for line in [geom["coordinates"]] if geom["type"] == "LineString" else geom["coordinates"]:
            lines.append((name, [(float(x), float(y)) for x, y in line]))
    out = []
    for f in numbers["features"]:
        number, geom = str(f["properties"].get("housenumber") or ""), f["geometry"]
        if not number or geom["type"] != "Point":
            continue
        p = (float(geom["coordinates"][0]), float(geom["coordinates"][1]))
        best = min(
            ((min(_point_segment_px(p, a, b) for a, b in itertools.pairwise(pts)), name)
             for name, pts in lines if len(pts) > 1),
            default=None,
        )  # fmt: skip
        if best and best[0] * metres_per_px <= ADDRESS_MAX_M:
            out.append((best[1], number, *_to_lonlat(tile, p[0], p[1], extent)))
    return out


class AddressIndex:
    """(normalised street, house number) -> point. Numbers are upper-cased ('35A')."""

    def __init__(self, points: dict[str, Point]) -> None:
        self.points = points

    def __len__(self) -> int:
        return len(self.points)

    @staticmethod
    def key(street: str, number: str) -> str:
        return f"{normalize(street)}|{number.strip().upper()}"

    def get(self, street: str, number: str) -> Point | None:
        return self.points.get(self.key(street, number))

    def to_json(self) -> str:
        return json.dumps(
            {k: [round(v[0], 6), round(v[1], 6)] for k, v in sorted(self.points.items())}
        )

    @classmethod
    def from_json(cls, text: str) -> AddressIndex:
        return cls({k: (v[0], v[1]) for k, v in json.loads(text).items()})


def fetch_indexes(
    client: PoliteClient,
    bbox: tuple[float, float, float, float],
    centre: Point | None = None,
    log: Callable[[str], None] = lambda _: None,
) -> tuple[StreetIndex, AddressIndex]:
    """Street and house-number indexes from one pass over the tiles. `centre` must lie inside the
    municipality (default: the bbox centre)."""
    tilejson = json.loads(client.get(TILEJSON_URL).content)
    template = tilejson["tiles"][0]
    tiles = list(tile_range(bbox))
    segments: list[tuple[str, float, float]] = []
    borders: list[Segment] = []
    numbers: list[tuple[str, str, float, float]] = []
    for i, (x, y) in enumerate(tiles, start=1):
        resp = client.get(template.format(z=ZOOM, x=x, y=y))
        if resp.status == 200 and resp.content:  # noqa: PLR2004
            segments += segments_from_tile(resp.content, (x, y))
            borders += borders_from_tile(resp.content, (x, y))
            numbers += addresses_from_tile(resp.content, (x, y))
        if i % 10 == 0:
            log(f"tiles {i}/{len(tiles)}")
    centre = centre or ((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)
    log(f"{len(borders)} border segments; keeping streets in the same municipality as {centre}")
    inside = same_side(borders, centre)
    streets = StreetIndex.from_segments(segments, centre, inside=inside)
    addresses: dict[str, Point] = {}
    for street, number, lon, lat in numbers:
        if inside((lon, lat)):
            addresses.setdefault(AddressIndex.key(street, number), (lon, lat))
    log(f"{len(streets)} streets, {len(addresses)} house numbers")
    return streets, AddressIndex(addresses)


def fetch_street_index(
    client: PoliteClient,
    bbox: tuple[float, float, float, float],
    centre: Point | None = None,
    log: Callable[[str], None] = lambda _: None,
) -> StreetIndex:
    return fetch_indexes(client, bbox, centre, log)[0]
