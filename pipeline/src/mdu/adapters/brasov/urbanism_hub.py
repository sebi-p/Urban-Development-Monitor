"""Urbanism and construction hub page (P0). See docs/sources/brasov.md#urbanism_hub."""

import re
from dataclasses import dataclass

from mdu.adapters.brasov.common import BASE_URL, absolute, clean, parse, parse_size

PAGE_URL = f"{BASE_URL}/urbanism-si-constructii"
_PLAN_FILE = re.compile(r"/file-zone/urbanism/(pud|puz)/([^/]+)/", re.I)
_COMMITTEE_FILE = re.compile(r"/file-zone/urbanism/comisii/(ctatu|circulatie)/([^/]+)/", re.I)


@dataclass(frozen=True)
class HubFile:
    url: str
    kind: str  # "pud" | "puz" | "ctatu" | "circulatie"
    group: str  # project folder (private) or committee sub-folder ("ordine-zi", "hotarari")
    label: str
    size_bytes: int | None


def parse_page(html: bytes | str) -> list[HubFile]:
    tree = parse(html)
    out: list[HubFile] = []
    seen: set[str] = set()
    for a in tree.css("a[href*='/file-zone/urbanism/']"):
        url = absolute(a.attributes.get("href") or "")
        if url in seen:
            continue
        m = _PLAN_FILE.search(url) or _COMMITTEE_FILE.search(url)
        if not m:
            continue
        seen.add(url)
        text = clean(a.parent) if a.parent is not None else clean(a)
        out.append(
            HubFile(
                url=url,
                kind=m.group(1).lower(),
                group=m.group(2),
                label=clean(a).split(" [")[0],
                size_bytes=parse_size(text) or parse_size(clean(a)),
            )
        )
    return out
