"""The source adapter contract (PLAN §7). One `Adapter` per source; a city lists its adapters in
`mdu.adapters.<city>.registry.ADAPTERS`.

An adapter provides any of these hooks:

- `projects` turns listing pages into project records (written by `mdu.ingest.write_records`);
- `events` adds dated events to existing projects (e.g. a council agenda naming a project);
- `discover` lists document URLs for the fetch stage;
- `backfill` walks a sequentially numbered source backwards for history the listings no longer
  show (`mdu backfill`, M5.1);
- `decision_facts` reads a council decision item stored from the minutes (plan kind, title,
  initiator) for the `decisions` stage (M5.3).

Files whose listing label matches `never_mirror` (for example registers that list the residents
who commented) are queued as `skipped` and never requested (PLAN §11).
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import date
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import psycopg

    from mdu.core.documents import Upload
    from mdu.core.http import PoliteClient
    from mdu.core.streets import StreetIndex
    from mdu.decisions import ItemFacts
    from mdu.ingest import IngestStats, ProjectRecord
    from mdu.stages import DiscoveredItem

ProjectsHook = Callable[["PoliteClient", "StreetIndex", "IngestStats"], "list[ProjectRecord]"]
EventsHook = Callable[
    ["psycopg.Connection[Any]", "PoliteClient", "Upload | None", "StreetIndex"], Counter[str]
]
DiscoverHook = Callable[..., "list[DiscoveredItem]"]


@dataclass(frozen=True)
class Walked:
    """What one number of a walked source held: nothing, or an item with its date, maybe a
    project and documents to queue."""

    found: bool
    published: date | None = None
    record: ProjectRecord | None = None
    items: tuple[DiscoveredItem, ...] = ()


@dataclass(frozen=True)
class IdWalk:
    """A source whose items have sequential numbers (PLAN §10.2): `start` gives the newest number,
    `read` one item. The driver (`mdu.backfill`) walks down from `start` to a date."""

    start: Callable[[PoliteClient], int]
    read: Callable[[PoliteClient, StreetIndex, IngestStats, int], Walked]


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
    backfill: IdWalk | None = None
    decision_facts: Callable[[str], ItemFacts] | None = None
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
