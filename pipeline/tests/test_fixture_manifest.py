"""Checks on the committed fixture manifests (raw files are in private R2, ADR 0004)."""

import hashlib
import json
import re

import pytest

from mdu.fixtures import FIXTURES_ROOT, FixtureSet, fixture_bytes

MANIFESTS = sorted(FIXTURES_ROOT.glob("*/manifest.json"))
CASES = [
    (m.parent.name, fid) for m in MANIFESTS for fid in sorted(FixtureSet(m.parent.name).load())
]


@pytest.mark.parametrize("path", MANIFESTS, ids=lambda p: p.parent.name)
def test_manifest_holds_no_urls_or_paths(path: object) -> None:
    text = FixtureSet(path.parent.name).manifest_path.read_text(encoding="utf-8")  # type: ignore[attr-defined]
    assert not re.search(r"https?://|file-zone|www\.", text), "URLs and paths stay private"
    for f in json.loads(text)["fixtures"]:
        assert set(f) == {
            "id",
            "source",
            "fetched_at",
            "status",
            "content_type",
            "size",
            "sha256",
            "file",
            "note",
        }


@pytest.mark.parametrize(("city", "fixture_id"), CASES)
def test_cached_fixture_matches_manifest(city: str, fixture_id: str) -> None:
    data = fixture_bytes(city, fixture_id)  # skips locally when not pulled
    f = FixtureSet(city).load()[fixture_id]
    assert hashlib.sha256(data).hexdigest() == f.sha256
    assert len(data) == f.size
