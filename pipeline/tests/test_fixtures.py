import hashlib
import json
from pathlib import Path

import pytest

from mdu.core.http import Response
from mdu.fixtures import FixtureSet, extension_for


class MemoryStore:
    """Stands in for ObjectStore (R2)."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def exists(self, key: str) -> bool:
        return key in self.objects

    def put(self, key: str, data: bytes, content_type: str | None = None) -> None:
        self.objects[key] = data

    def get(self, key: str) -> bytes:
        return self.objects[key]


def resp(
    body: bytes, ctype: str = "application/pdf", url: str = "https://x.test/a.pdf"
) -> Response:
    return Response(url=url, status=200, headers={"content-type": ctype}, content=body)


def test_extension_from_content_type_or_url() -> None:
    assert extension_for("text/html; charset=utf-8", "https://x.test/") == "html"
    assert extension_for("application/octet-stream", "https://x.test/doc.PDF?x=1") == "pdf"
    assert extension_for(None, "https://x.test/weird.name.toolongext") == "bin"


def test_capture_writes_file_and_metadata_only_manifest(tmp_path: Path) -> None:
    fs = FixtureSet("city", root=tmp_path)
    f = fs.add(
        source="debates", name="sample", resp=resp(b"%PDF-1.7 hello"), note="n", replace=False
    )
    assert f.id == "debates/sample"
    assert f.sha256 == hashlib.sha256(b"%PDF-1.7 hello").hexdigest()
    assert fs.local_path(f).read_bytes() == b"%PDF-1.7 hello"
    text = fs.manifest_path.read_text()
    manifest = json.loads(text)
    assert "hello" not in text  # never the content itself
    assert "x.test" not in text  # never the URL: folder names can contain personal names
    assert manifest["fixtures"][0]["file"] == f"{f.sha256}.pdf"
    assert fs.source_url(f) == "https://x.test/a.pdf"  # kept in the private sidecar


def test_capture_refuses_to_overwrite_without_replace(tmp_path: Path) -> None:
    fs = FixtureSet("city", root=tmp_path)
    fs.add(source="s", name="n", resp=resp(b"a"), note="", replace=False)
    with pytest.raises(ValueError, match="already exists"):
        fs.add(source="s", name="n", resp=resp(b"b"), note="", replace=False)
    assert fs.add(source="s", name="n", resp=resp(b"b"), note="", replace=True).size == 1


def test_push_then_pull_round_trip_and_verify(tmp_path: Path) -> None:
    store = MemoryStore()
    fs = FixtureSet("city", root=tmp_path)
    f = fs.add(source="s", name="n", resp=resp(b"data"), note="", replace=False)
    assert fs.push(store) == 1  # type: ignore[arg-type]
    assert fs.push(store) == 0  # type: ignore[arg-type]
    key = f"fixtures/city/{f.file}"
    assert set(store.objects) == {key, f"{key}.meta.json"}

    fs.local_path(f).unlink()
    fs.meta_path(f).unlink()
    assert fs.verify() == [f"s/n: missing locally ({f.file})"]
    assert fs.pull(store) == 1  # type: ignore[arg-type]
    assert fs.verify() == []
    assert fs.source_url(f) == "https://x.test/a.pdf"


def test_pull_rejects_a_tampered_r2_copy(tmp_path: Path) -> None:
    store = MemoryStore()
    fs = FixtureSet("city", root=tmp_path)
    f = fs.add(source="s", name="n", resp=resp(b"data"), note="", replace=False)
    store.objects[fs.r2_key(f)] = b"evil"
    fs.local_path(f).unlink()
    with pytest.raises(ValueError, match="does not match"):
        fs.pull(store)  # type: ignore[arg-type]
