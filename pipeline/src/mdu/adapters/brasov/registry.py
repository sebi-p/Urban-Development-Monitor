"""Brașov's source adapters (PLAN §7). `DAILY` is the order `mdu daily` runs them in: projects
first, so the agenda can match them, then document discovery."""

import re

from mdu.adapters.brasov import council_agendas, council_debates, notices, urbanism_hub
from mdu.adapters.brasov.agendas import agenda_events
from mdu.adapters.brasov.backfill import newest_article, read_article
from mdu.adapters.brasov.discover import debate_documents, hub_documents, notice_attachments
from mdu.adapters.brasov.ingest import debates, urbanism_notices
from mdu.core.adapter import Adapter, IdWalk, NeverMirror

# The public debates' "Registru opinii" lists the residents who commented (docs/sources).
REGISTERS = NeverMirror(
    re.compile(r"\bregistr\w*\s+(?:de\s+|al\s+)?(?:opinii|observa|propuneri|sugestii)", re.I),
    "register of public comments (names residents)",
)

ADAPTERS: dict[str, Adapter] = {
    a.key: a
    for a in (
        Adapter(
            "brasov.council_debates",
            council_debates.LISTING_URL,
            projects=debates,
            discover=debate_documents,
            never_mirror=(REGISTERS,),
        ),
        Adapter(
            "brasov.notices",
            notices.LISTING_URL,
            projects=urbanism_notices,
            discover=notice_attachments,
            backfill=IdWalk(newest_article, read_article),
            never_mirror=(REGISTERS,),
        ),
        Adapter(
            "brasov.council_agendas",
            council_agendas.agenda_url(council_agendas.LATEST_KNOWN_ID),
            events=agenda_events,
        ),
        Adapter(
            "brasov.urbanism_hub",
            urbanism_hub.PAGE_URL,
            discover=hub_documents,
            never_mirror=(REGISTERS,),
        ),
    )
}

DAILY = [
    "brasov.council_debates",
    "brasov.notices",
    "brasov.council_agendas",
    "brasov.urbanism_hub",
]
