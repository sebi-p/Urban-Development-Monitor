"""The source adapter contract (PLAN §7). One `Adapter` per source; a city lists its adapters in
`mdu.adapters.<city>.registry.ADAPTERS`.

An adapter provides any of three hooks:

- `projects` turns listing pages into project records (written by `mdu.ingest.write_records`);
- `events` adds dated events to existing projects (e.g. a council agenda naming a project);
- `discover` lists document URLs for the fetch stage.

Files whose listing label matches `never_mirror` (for example registers that list the residents
who commented) are queued as `skipped` and never requested (PLAN §11).
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import psycopg

    from mdu.core.documents import Upload
    from mdu.core.http import PoliteClient
    from mdu.core.streets import StreetIndex
    from mdu.ingest import IngestStats, ProjectRecord
    from mdu.stages import DiscoveredItem

ProjectsHook = Callable[["PoliteClient", "StreetIndex", "IngestStats"], "list[ProjectRecord]"]
EventsHook = Callable[
    ["psycopg.Connection[Any]", "PoliteClient", "Upload | None", "StreetIndex"], Counter[str]
]
DiscoverHook = Callable[..., "list[DiscoveredItem]"]


@dataclass(frozen=True)
class NeverMirror:
    pattern: re.Pattern[str]
    reason: str

    def matches(self, label: str) -> bool:
        return bool(self.pattern.search(label))


@dataclass(frozen=True)
class Adapter:
    key: str  # "brasov.council_debates"
    base_url: str
    projects: ProjectsHook | None = None
    events: EventsHook | None = None
    discover: DiscoverHook | None = None
    never_mirror: tuple[NeverMirror, ...] = ()

    @property
    def city(self) -> str:
        return self.key.split(".", 1)[0]

    def mark_never_mirror(self, items: Iterable[DiscoveredItem]) -> list[DiscoveredItem]:
        """Adds hints['never_mirror'] = reason to items whose label matches a rule."""
        from mdu.stages import DiscoveredItem  # noqa: PLC0415

        out = []
        for item in items:
            label = str(item.hints.get("label") or "")
            rule = next((r for r in self.never_mirror if r.matches(label)), None)
            out.append(
                DiscoveredItem(item.url, {**item.hints, "never_mirror": rule.reason})
                if rule
                else item
            )
        return out
