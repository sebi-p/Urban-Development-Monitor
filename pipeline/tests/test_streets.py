from mdu.core.streets import StreetIndex, _clip, fold, normalize, same_side, tile_range

CENTRE = (25.60, 45.65)
INDEX = StreetIndex.from_segments(
    [
        ("Strada Lungă", 25.600, 45.650),
        ("Strada Lungă", 25.605, 45.652),
        ("Strada Lungă", 25.610, 45.654),
        ("Bulevardul Griviței", 25.58, 45.66),
        ("Calea București", 25.63, 45.63),
        ("Strada Mihai Viteazul", 25.61, 45.64),
        # The same name in a neighbouring town, about 8 km away, must not win.
        ("Strada Republicii", 25.690, 45.610),
        ("Strada Republicii", 25.691, 45.611),
        ("Strada Republicii", 25.692, 45.612),
        ("Strada Republicii", 25.589, 45.643),
    ],
    CENTRE,
)


def test_fold_handles_both_forms_of_s_and_t_comma() -> None:
    assert fold("Ștefan") == fold("Ştefan") == "stefan"
    assert fold("Țara") == fold("Ţara") == "tara"


def test_normalize_drops_street_types() -> None:
    assert normalize("Strada Lungă") == "lunga"
    assert normalize("str. Lungă") == "lunga"
    assert normalize("B-dul Griviței") == "grivitei"
    assert normalize("Bulevardul Griviței") == "grivitei"
    assert normalize("Calea București") == "bucuresti"


def test_one_point_per_street_on_the_street_itself() -> None:
    assert len(INDEX) == 5
    p = INDEX.points["lunga"]
    assert (p.lon, p.lat) == (25.605, 45.652)  # the middle sample, on the street
    assert p.name == "Strada Lungă"


def test_duplicate_name_in_a_neighbouring_town_loses_to_the_city_one() -> None:
    p = INDEX.points["republicii"]
    assert (p.lon, p.lat) == (25.589, 45.643)


def test_matches_mentions_in_official_titles() -> None:
    def name(text: str) -> str | None:
        hit = INDEX.match(text)
        return hit.name if hit else None

    assert name("P.U.D. Construire locuințe, str. Lungă nr. 66, Brașov") == "Strada Lungă"
    assert name("ZONĂ COMERCIALĂ – B-dul Griviței f.n.") == "Bulevardul Griviței"
    assert name("Showroom auto, Calea București nr. 239") == "Calea București"
    assert name("P.U.Z. str. Mihai Viteazul bloc 3, sc. A") == "Strada Mihai Viteazul"
    assert name("PUZ zona de locuinte, str.Lungă fn") == "Strada Lungă"  # no space after "str."
    assert name("Regulament local de publicitate") is None
    assert name("str. Inexistentă nr. 1") is None


def test_round_trips_through_json() -> None:
    again = StreetIndex.from_json(INDEX.to_json())
    assert again.points == INDEX.points


def test_tile_range_covers_the_bbox_at_zoom_14() -> None:
    tiles = list(tile_range((25.52, 45.58, 25.68, 45.70)))
    assert 40 <= len(tiles) <= 100
    xs = sorted({x for x, _ in tiles})
    assert xs == list(range(xs[0], xs[-1] + 1))


# A square "municipality" border around the centre: 25.55-25.65 x 45.60-45.70.
BORDER = [
    ((25.55, 45.60), (25.65, 45.60)),
    ((25.65, 45.60), (25.65, 45.70)),
    ((25.65, 45.70), (25.55, 45.70)),
    ((25.55, 45.70), (25.55, 45.60)),
]


def test_same_side_separates_the_city_from_a_neighbour() -> None:
    inside = same_side(BORDER, CENTRE)
    assert inside((25.59, 45.64))
    assert not inside((25.675, 45.614))  # outside the square, e.g. a neighbouring town


def test_streets_only_in_a_neighbouring_town_are_dropped() -> None:
    index = StreetIndex.from_segments(
        [("Strada Bârsei", 25.675, 45.614), ("Strada Lungă", 25.60, 45.65)],
        CENTRE,
        inside=same_side(BORDER, CENTRE),
    )
    assert "barsei" not in index.points
    assert "lunga" in index.points


def test_clip_keeps_only_the_part_inside_the_tile() -> None:
    assert _clip((-10, 5), (10, 5), 4) is None  # passes above the tile
    assert _clip((-10, 2), (10, 2), 4) == ((0.0, 2.0), (4.0, 2.0))
    assert _clip((5, 5), (6, 6), 4) is None
