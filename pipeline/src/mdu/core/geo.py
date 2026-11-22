"""Locations from the plans' own coordinates (PLAN §7 stage 7, M3.4; ADR 0011).

Romanian plan sheets and topographic surveys list the boundary of the regulated land as an
"Inventar de coordonate" in the national grid, Stereo 70 (EPSG:31700): numbered points with X
(northing) and Y (easting) in metres, to the centimetre or millimetre. Those pairs are read from
the extracted text, converted to WGS84 with PROJ, and reduced to one point: the centre of the
points inside the city's bounding box, after dropping outliers. Pairs without decimals are
ignored, which keeps cadastral and register numbers out.
"""

from __future__ import annotations

import re
import statistics
from dataclasses import dataclass
from functools import cache
from typing import TYPE_CHECKING

from mdu.core.streets import Point, _km

if TYPE_CHECKING:
    import pyproj

# X (northing) and Y (easting) of Romania's Stereo 70 grid, with decimals, in either order.
_COORD = r"(\d{6}[.,]\d{2,3})"
_PAIR = re.compile(rf"{_COORD}\s*[|;,\s]\s*{_COORD}")
X_RANGE = (200_000.0, 800_000.0)
Y_RANGE = (100_000.0, 900_000.0)
MIN_POINTS = 3
OUTLIER_KM = 2.0


@cache
def _transformer() -> pyproj.Transformer:
    import pyproj  # noqa: PLC0415

    return pyproj.Transformer.from_crs("EPSG:31700", "EPSG:4326", always_xy=True)


def _num(s: str) -> float:
    return float(s.replace(",", "."))


def stereo70_pairs(text: str) -> list[tuple[float, float]]:
    """(X, Y) pairs in Stereo 70 from an inventory table; X is the northing."""
    out = []
    for a, b in _PAIR.findall(text):
        x, y = _num(a), _num(b)
        if X_RANGE[0] <= min(x, y) and max(x, y) <= Y_RANGE[1]:
            out.append((x, y))  # as listed; parcel_location also tries the columns swapped
    return out


def to_wgs84(x: float, y: float) -> Point:
    lon, lat = _transformer().transform(y, x)
    return float(lon), float(lat)


@dataclass(frozen=True)
class ParcelLocation:
    lon: float
    lat: float
    points: int  # boundary points used


def parcel_location(
    pairs: list[tuple[float, float]], bbox: tuple[float, float, float, float]
) -> ParcelLocation | None:
    """Centre of the inventory points inside the bounding box, outliers removed."""
    min_lon, min_lat, max_lon, max_lat = bbox

    def inside(candidates: list[tuple[float, float]]) -> list[Point]:
        return [p for p in (to_wgs84(x, y) for x, y in candidates)
                if min_lon <= p[0] <= max_lon and min_lat <= p[1] <= max_lat]  # fmt: skip

    # Inventories list X (northing) then Y (easting); OCR sometimes reads the columns swapped.
    pts = max(inside(pairs), inside([(y, x) for x, y in pairs]), key=len)
    if len(pts) < MIN_POINTS:
        return None
    median = (statistics.median(p[0] for p in pts), statistics.median(p[1] for p in pts))
    kept = [p for p in pts if _km(p, median) <= OUTLIER_KM]
    if len(kept) < MIN_POINTS:
        return None
    lon = sum(p[0] for p in kept) / len(kept)
    lat = sum(p[1] for p in kept) / len(kept)
    return ParcelLocation(round(lon, 6), round(lat, 6), len(kept))
