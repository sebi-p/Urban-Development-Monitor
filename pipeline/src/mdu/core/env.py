"""Loads the repo-root `.env` (gitignored) for local runs. Real environment variables win."""

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]


def load_env(path: Path = REPO_ROOT / ".env") -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))
