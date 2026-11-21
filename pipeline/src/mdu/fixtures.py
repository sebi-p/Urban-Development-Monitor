"""Test fixtures: raw captures live in private R2, only the manifest is committed.

Raw HTML and PDFs from municipal sites can contain personal data or third-party copyrighted work,
so they never enter git (ADR 0004). Each capture is stored under
`fixtures/<city>/<sha256>.<ext>` in R2 and cached locally in the gitignored
`pipeline/tests/fixtures/<city>/files/`, next to a private `<sha256>.meta.json` holding the URL
and response headers. URLs stay private too: municipal folder names can contain an applicant's
name. The committed `manifest.json` records only: id, source, fetch time, status, content type,
size, SHA-256 and a neutral note.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from mdu.core.env import REPO_ROOT

if TYPE_CHECKING:
    from mdu.core.http import Response
    from mdu.core.storage import ObjectStore

FIXTURES_ROOT = REPO_ROOT / "pipeline" / "tests" / "fixtures"

EXTENSIONS = {
    "text/html": "html",
    "application/xhtml+xml": "html",
    "application/pdf": "pdf",
    "application/json": "json",
    "application/xml": "xml",
    "text/xml": "xml",
    "text/plain": "txt",
}


@dataclass(frozen=True)
class Fixture:
    id: str  # "<source>/<name>"
    source: str
    fetched_at: str
    status: int
    content_type: str | None
    size: int
    sha256: str
    file: str
    note: str = ""


def extension_for(content_type: str | None, url: str) -> str:
    base = (content_type or "").split(";")[0].strip().lower()
    if base in EXTENSIONS:
        return EXTENSIONS[base]
    suffix = Path(url.split("?", maxsplit=1)[0]).suffix.lstrip(".").lower()
    return suffix if suffix.isalnum() and len(suffix) <= 5 else "bin"  # noqa: PLR2004


class FixtureSet:
    def __init__(self, city: str, root: Path = FIXTURES_ROOT) -> None:
        self.city = city
        self.dir = root / city
        self.files_dir = self.dir / "files"
        self.manifest_path = self.dir / "manifest.json"

    def load(self) -> dict[str, Fixture]:
        if not self.manifest_path.is_file():
            return {}
        data = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        return {f["id"]: Fixture(**f) for f in data["fixtures"]}

    def save(self, fixtures: dict[str, Fixture]) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        body = {
            "city": self.city,
            "note": "Metadata only. Raw files are in private R2; run `uv run mdu fixtures pull`.",
            "fixtures": [asdict(fixtures[k]) for k in sorted(fixtures)],
        }
        text = json.dumps(body, ensure_ascii=False, indent=2) + "\n"
        self.manifest_path.write_text(text, encoding="utf-8")

    def r2_key(self, fixture: Fixture) -> str:
        return f"fixtures/{self.city}/{fixture.file}"

    def local_path(self, fixture: Fixture) -> Path:
        return self.files_dir / fixture.file

    def meta_path(self, fixture: Fixture) -> Path:
        """Private sidecar with the source URL and headers. Never committed."""
        return self.files_dir / f"{fixture.sha256}.meta.json"

    def private_meta(self, fixture: Fixture) -> dict[str, Any]:
        """The private sidecar (URL, listing label); empty when it isn't cached locally."""
        path = self.meta_path(fixture)
        return dict(json.loads(path.read_text(encoding="utf-8"))) if path.is_file() else {}

    def source_url(self, fixture: Fixture) -> str | None:
        path = self.meta_path(fixture)
        if not path.is_file():
            return None
        url = json.loads(path.read_text(encoding="utf-8")).get("url")
        return str(url) if url else None

    def add(self, *, source: str, name: str, resp: Response, note: str, replace: bool) -> Fixture:
        fixtures = self.load()
        fid = f"{source}/{name}"
        if fid in fixtures and not replace:
            raise ValueError(f"fixture {fid} already exists; pass --replace to overwrite")
        sha = hashlib.sha256(resp.content).hexdigest()
        fixture = Fixture(
            id=fid,
            source=source,
            fetched_at=datetime.now(UTC).replace(microsecond=0).isoformat(),
            status=resp.status,
            content_type=resp.content_type,
            size=len(resp.content),
            sha256=sha,
            file=f"{sha}.{extension_for(resp.content_type, resp.url)}",
            note=note,
        )
        self.files_dir.mkdir(parents=True, exist_ok=True)
        self.local_path(fixture).write_bytes(resp.content)
        private_meta = {"url": resp.url, "status": resp.status, "headers": resp.headers}
        self.meta_path(fixture).write_text(
            json.dumps(private_meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        fixtures[fid] = fixture
        self.save(fixtures)
        return fixture

    def verify(self) -> list[str]:
        """Problems with the local cache: missing files or hash mismatches."""
        problems = []
        for f in self.load().values():
            path = self.local_path(f)
            if not path.is_file():
                problems.append(f"{f.id}: missing locally ({f.file})")
            elif hashlib.sha256(path.read_bytes()).hexdigest() != f.sha256:
                problems.append(f"{f.id}: SHA-256 mismatch")
        return problems

    def push(self, store: ObjectStore) -> int:
        uploaded = 0
        for f in self.load().values():
            key = self.r2_key(f)
            if not store.exists(key):
                store.put(key, self.local_path(f).read_bytes(), f.content_type)
                uploaded += 1
            meta = self.meta_path(f)
            if meta.is_file() and not store.exists(f"{key}.meta.json"):
                store.put(f"{key}.meta.json", meta.read_bytes(), "application/json")
        return uploaded

    def pull(self, store: ObjectStore) -> int:
        downloaded = 0
        self.files_dir.mkdir(parents=True, exist_ok=True)
        for f in self.load().values():
            path = self.local_path(f)
            if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == f.sha256:
                continue
            data = store.get(self.r2_key(f))
            if hashlib.sha256(data).hexdigest() != f.sha256:
                raise ValueError(f"{f.id}: R2 copy does not match the manifest SHA-256")
            path.write_bytes(data)
            meta_key = f"{self.r2_key(f)}.meta.json"
            if store.exists(meta_key):
                self.meta_path(f).write_bytes(store.get(meta_key))
            downloaded += 1
        return downloaded


def fixture_bytes(city: str, fixture_id: str) -> bytes:
    """Test helper. Skips the test when the raw file isn't cached locally, unless
    MDU_REQUIRE_FIXTURES=1 (set in CI), where a missing fixture is an error."""
    import pytest  # noqa: PLC0415 - test-only dependency

    fs = FixtureSet(city)
    fixtures = fs.load()
    if fixture_id not in fixtures:
        raise KeyError(f"no fixture {fixture_id} in {fs.manifest_path}")
    path = fs.local_path(fixtures[fixture_id])
    if not path.is_file():
        if os.environ.get("MDU_REQUIRE_FIXTURES") == "1":
            raise FileNotFoundError(f"{path} missing; run `uv run mdu fixtures pull --city {city}`")
        pytest.skip(f"fixture {fixture_id} not pulled (uv run mdu fixtures pull --city {city})")
    return path.read_bytes()
