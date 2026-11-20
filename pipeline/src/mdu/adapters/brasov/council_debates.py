"""Draft council decisions in public debate (P0). See docs/sources/brasov.md#council_debates."""

from dataclasses import dataclass, field
from datetime import date

from mdu.adapters.brasov.common import BASE_URL, absolute, clean, parse, parse_ro_date, parse_size

LISTING_URL = f"{BASE_URL}/consiliul-local/proiecte-de-hotarare-dezbatere-publica"
FILES_PATH = "/file-zone/proiecte/hotarare/"


@dataclass(frozen=True)
class FileLink:
    url: str
    label: str
    size_bytes: int | None


@dataclass(frozen=True)
class Debate:
    published: date | None
    status: str
    title: str
    folder: str  # the <CODE> path segment; can be free text, so treat it as private
    files: list[FileLink] = field(default_factory=list)


def parse_listing(html: bytes | str) -> list[Debate]:
    tree = parse(html)
    debates = []
    for card in tree.css("div.card-body"):
        links = card.css(f"a[href*='{FILES_PATH}']")
        if not links:
            continue
        files = []
        for a in links:
            href = a.attributes.get("href") or ""
            label = clean(a)
            size_node = a.next
            size_text = clean(size_node) if size_node is not None else ""
            parent = a.parent
            size = parse_size(size_text) or parse_size(label) or parse_size(clean(parent))
            files.append(FileLink(url=absolute(href), label=label.split(" [")[0], size_bytes=size))
        folder = files[0].url.split(FILES_PATH, 1)[1].split("/", 1)[0]
        debates.append(
            Debate(
                published=parse_ro_date(clean(card.css_first("span.btn-primary"))),
                status=clean(card.css_first("span.btn-secondary")),
                title=clean(card.css_first("h2")),
                folder=folder,
                files=files,
            )
        )
    return debates
