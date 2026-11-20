from mdu.core.jurisdiction import CONFIG_DIR, load_jurisdiction


def test_every_jurisdiction_config_loads() -> None:
    files = sorted(CONFIG_DIR.glob("*.yaml"))
    assert files
    for path in files:
        j = load_jurisdiction(path.stem)
        assert j.slug == path.stem
        min_lon, min_lat, max_lon, max_lat = j.bbox
        assert min_lon < max_lon
        assert min_lat < max_lat
        assert all(isinstance(h, str) and "/" not in h for h in j.blocked_hosts)
