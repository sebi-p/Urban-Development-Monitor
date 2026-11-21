"""Council agendas -> 'on the council agenda' events for projects already known (M2.7).

No page links to the newest session, so the adapter probes session ids upwards from the newest
one it has stored, and re-reads that one (agendas change until the session). An agenda item
naming a project is matched on the normalised draft-decision title (`title_key`); a key that fits
more than one project is ignored. Fuzzier matching is the linker's job (M3.3).
"""

from collections import Counter
from collections.abc import Iterable
from typing import Any

import psycopg

from mdu.adapters.brasov import council_agendas
from mdu.core.documents import Upload
from mdu.core.http import HttpError, PoliteClient
from mdu.core.streets import StreetIndex
from mdu.ingest import EventRecord, SourceDoc, project_titles, write_events

KEY = "brasov.council_agendas"
MAX_EMPTY = 2  # stop probing after this many ids in a row without an agenda


def matches(
    agenda: council_agendas.Agenda, session_id: int, titles: Iterable[tuple[str, str]]
) -> list[EventRecord]:
    """Pure: agenda items whose normalised title names exactly one known project."""
    if agenda.session_date is None:
        return []
    by_key: dict[str, set[str]] = {}
    for project_id, title in titles:
        by_key.setdefault(council_agendas.title_key(title), set()).add(project_id)
    out = []
    for item in agenda.entries:
        ids = by_key.get(council_agendas.title_key(item.title), set())
        if len(ids) == 1:
            out.append(
                EventRecord(
                    project_id=next(iter(ids)),
                    event_date=agenda.session_date,
                    event_type="council_agenda",
                    title=f"Pe ordinea de zi a ședinței din {agenda.session_date:%d.%m.%Y}",
                    details={"session_id": session_id, "item": item.number},
                )
            )
    return out


def newest_seen(conn: psycopg.Connection[Any]) -> int:
    rows = conn.execute(
        """select d.url from raw_document d join jurisdiction j on j.id = d.jurisdiction_id
           where j.slug = 'brasov' and d.doc_type = 'agenda'"""
    ).fetchall()
    ids = [council_agendas.session_id_of(r[0]) for r in rows]
    return max([i for i in ids if i is not None], default=council_agendas.LATEST_KNOWN_ID)


def agenda_events(
    conn: psycopg.Connection[Any],
    client: PoliteClient,
    upload: Upload | None,
    streets: StreetIndex,
) -> Counter[str]:
    del streets  # agendas name projects that already have a location
    counts: Counter[str] = Counter()
    session_id, empty = newest_seen(conn), 0
    while empty < MAX_EMPTY:
        url = council_agendas.agenda_url(session_id)
        resp = client.get(url)
        if resp.status != 200:  # noqa: PLR2004
            raise HttpError(f"agenda {session_id} returned HTTP {resp.status}")
        agenda = council_agendas.parse_agenda(resp.content)
        if agenda is None:
            empty += 1
        else:
            empty = 0
            events = matches(agenda, session_id, project_titles(conn, "brasov"))
            write_events(
                conn,
                city="brasov",
                adapter=KEY,
                base_url=council_agendas.agenda_url(council_agendas.LATEST_KNOWN_ID),
                source=SourceDoc(resp.url, resp.status, resp.content, resp.content_type),
                doc_type="agenda",
                group=f"session:{session_id}",
                events=events,
                upload=upload,
            )
            counts["agendas"] += 1
            counts["events"] += len(events)
        session_id += 1
    return counts
