"""Jurisdiction config from `config/jurisdictions/<slug>.yaml` (PLAN §6)."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from mdu.core.env import REPO_ROOT

CONFIG_DIR = REPO_ROOT / "config" / "jurisdictions"


@dataclass(frozen=True)
class Jurisdiction:
    slug: str
    name: str
    timezone: str
    bbox: tuple[float, float, float, float]
    config: dict[str, Any] = field(default_factory=dict)

    @property
    def blocked_hosts(self) -> list[str]:
        """Hosts the pipeline must never request, e.g. registers whose robots.txt forbids it."""
        return list(self.config.get("blocked_hosts", []))


def load_jurisdiction(slug: str, config_dir: Path = CONFIG_DIR) -> Jurisdiction:
    path = config_dir / f"{slug}.yaml"
    if not path.is_file():
        raise FileNotFoundError(f"no jurisdiction config at {path}")
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    min_lon, min_lat, max_lon, max_lat = (float(x) for x in data["bbox"])
    return Jurisdiction(
        slug=data["slug"],
        name=data["name"],
        timezone=data.get("timezone", "Europe/Bucharest"),
        bbox=(min_lon, min_lat, max_lon, max_lat),
        config=data.get("config") or {},
    )
