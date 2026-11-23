"""Council session minutes (P1, M5.3). See docs/sources/brasov.md#council_minutes.

A set of minutes lists every item of the session's agenda with the committees' opinion and the
outcome: "a fost adoptat cu unanimitate de voturi", "adoptat 16 voturi si 10 abtineri", or, in
older minutes, "în urma votului a fost aprobat în unanimitate". `parse_minutes` keeps the planning
items (PUG, PUZ, PUD) with their outcome, the vote and the page. The minutes don't give the number
the adopted decision received.
"""

import re
from dataclasses import dataclass
from datetime import date

from mdu.adapters.brasov.common import BASE_URL, absolute, clean, parse, parse_ro_date
from mdu.core.enums import AgendaOutcome, ProjectKind
from mdu.core.streets import fold
from mdu.ingest import looks_like_organisation

LISTING_URL = f"{BASE_URL}/consiliul-local/procese-verbale-sedinte/"
_NUMBER = re.compile(r"CMBV-PV-(\d+)\.pdf", re.I)


def minutes_url(number: int) -> str:
    return f"{BASE_URL}/file-zone/procese-verbale/consiliu/CMBV-PV-{number}.pdf"


def source_ref(number: int) -> str:
    return f"PV-{number}"


@dataclass(frozen=True)
class MinutesLink:
    number: int
    url: str
    session_date: date | None
    label: str


def parse_listing(html: bytes | str) -> list[MinutesLink]:
    out = []
    for a in parse(html).css("a[href*='CMBV-PV-']"):
        url = absolute(a.attributes.get("href") or "")
        m = _NUMBER.search(url)
        if m:
            label = clean(a)
            out.append(MinutesLink(int(m.group(1)), url, parse_ro_date(label), label))
    return sorted({x.number: x for x in out}.values(), key=lambda x: -x.number)


_MONTHS = "ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie"  # noqa: E501
_DATE = rf"\d{{1,2}}\s*(?:[.\-/]\s*\d{{1,2}}\s*[.\-/]|\s+(?:{_MONTHS})\s+)\s*\d{{4}}"
_SESSION_DATE = re.compile(
    rf"(?:din\s+(?:data\s+de\s+)?|ziua\s+de\s+|pentru\s+data\s+de\s+)({_DATE})", re.I
)


def session_date_from_text(text: str) -> date | None:
    """Session date from the head of a minutes PDF: '... din data de 30 august 2013',
    '... din 28 noiembrie 2023' or '... din data de 25.09.2026'. Only the head is read, so a
    decision cited later in the text ('HCL din data de 17 iunie 2021') isn't taken."""
    head = text[:900]
    start = re.search(r"[îi]ncheiat", head, re.I)
    m = _SESSION_DATE.search(head, start.end() if start else 0)
    return parse_ro_date(re.sub(r"\s+", " ", m.group(1))) if m else None


def session_type_from_text(text: str) -> str | None:
    m = re.search(
        r"[șş]edin[țţ]a\s+(ordinar[ăa]|extraordinar[ăa]|de\s+[îi]ndat[ăa])", text[:900], re.I
    )
    return re.sub(r"\s+", " ", m.group(1)).lower() if m else None


# Where an agenda item starts: "PUNCTUL 85" / "Punctul nr. 20 al ordinii de zi" (with an optional
# running count before it, "(27)PUNCTUL 85"), or a numbered draft decision "24. Proiect de ...".
# A line starts after a newline or a page break.
_POINT = re.compile(
    r"(?im)(?:^|(?<=\f))[ \t]*(?:\(\d+\)\s*)?punctul\s*(?:nr\.?\s*)?(\d{1,3})\b[^\n\f]*"
)
_NUMBERED = re.compile(
    r"(?m)(?:^|(?<=\f))[ \t]*(\d{1,3})\s*\.\s+(?=(?:Proiect|PROIECT|Privind|PRIVIND)\b)"
)
_TITLE_START = re.compile(r"(?:Proiect|PROIECT|Privind|PRIVIND)\b")
# The title ends at a blank line, at the outcome sentence, or where someone takes the floor.
_TITLE_END = re.compile(
    r"\n[ \t]*\n|Proiectul\s+de\s+hot|\n[ \t]*(?:Domnul|Doamna|Dl\.|D-l|D-na|Se\s+supune)\b",
    re.I,
)
# A plan the decision is about: "documentației de urbanism ”P.U.Z. - ...", "documentaţia “P.U.D.",
# "aprobare documentație ”P.U.D.", "valabilitate a documentaţiei “Finalizare P.U.Z. ...".
_PLAN = re.compile(
    r"documenta[tţț]i\w*\s+(?:de\s+urban\w*\s+)?[\"“”„'«]?\s*(?:[îi]ntocmire\s+|finalizare\s+)?"
    r"p\.?\s?u\.?\s?([gzd])\b",
    re.I,
)
_KIND: dict[str, ProjectKind] = {"g": "pug", "z": "puz", "d": "pud"}


def kind_of(title: str) -> ProjectKind | None:
    """The plan a draft decision is about (PUG, PUZ, PUD), or None for any other decision."""
    m = _PLAN.search(fold(title))
    return _KIND[m.group(1).lower()] if m else None


_WORDS = {
    "unu": 1, "una": 1, "un": 1, "o": 1, "doi": 2, "doua": 2, "trei": 3, "patru": 4, "cinci": 5,
    "sase": 6, "sapte": 7, "opt": 8, "noua": 9, "zece": 10,
}  # fmt: skip
_N = r"(\d{1,2}|" + "|".join(_WORDS) + r")"


@dataclass(frozen=True)
class Vote:
    outcome: AgendaOutcome | None
    votes_for: int | None = None
    votes_against: int | None = None
    votes_abstain: int | None = None
    votes_absent: int | None = None
    unanimous: bool = False


_OUTCOMES: list[tuple[AgendaOutcome, re.Pattern[str]]] = [
    ("withdrawn", re.compile(r"\bretras\w*")),
    ("postponed", re.compile(r"\bamanat\w*|\bse amana\b|\breprogramat\w*")),
    (
        "rejected",
        re.compile(
            r"nu a fost (?:adoptat|aprobat)|nu (?:a )?intrun\w*|\brespins\w*"
            r"|nu s-a (?:adoptat|aprobat)|nu se aproba"
        ),
    ),
    ("adopted", re.compile(r"\badoptat\w*|\baprobat\w*|\bse aproba\b")),
]


def _num(s: str) -> int:
    return int(s) if s.isdigit() else _WORDS[s]


def read_vote(text: str) -> Vote:
    """The outcome and counts from an item's text after its title (folded). The last decision
    sentence wins: amendments are voted on before the draft itself."""
    folded = re.sub(r"\s+", " ", fold(text))
    sentences = [s for s in re.split(r"(?<=[.;])\s+(?=[a-z(])", folded) if s]
    for i in range(len(sentences) - 1, -1, -1):
        sentence = sentences[i]
        if "amendament" in sentence and "proiect" not in sentence:
            continue
        for outcome, pattern in _OUTCOMES:
            if pattern.search(sentence):
                # The counts can follow in brackets: "aprobat cu unanimitate. (22 voturi pentru
                # şi 3 neparticipări)."
                after = sentences[i + 1] if i + 1 < len(sentences) else ""
                return _counts(
                    f"{sentence} {after}" if after.startswith("(") else sentence, outcome
                )
    return Vote(None)


def _counts(s: str, outcome: AgendaOutcome) -> Vote:
    def find(pattern: str) -> int | None:
        m = re.search(pattern, s)
        return _num(m.group(1)) if m else None

    against = find(rf"\b{_N}\s*,?\s*(?:de\s+)?(?:voturi\s+|vot\s+)?impotriva")
    votes_for = find(rf"\b{_N}\s*(?:de\s+)?voturi?\b(?!\s+impotriva)")
    return Vote(
        outcome,
        votes_for=votes_for,
        votes_against=against,
        votes_abstain=find(rf"\b{_N}\s*(?:de\s+)?abtiner\w*"),
        votes_absent=find(rf"\b{_N}\s*(?:de\s+)?ne\s?participar\w*")
        or find(rf"\b{_N}\s*(?:consilieri\s+)?nu (?:au )?participat"),
        unanimous="unanimitate" in s,
    )


@dataclass(frozen=True)
class MinutesItem:
    number: int
    text: str  # the draft decision's title, one line, private initiators replaced
    kind: ProjectKind
    vote: Vote
    page: int  # 1-based page of the outcome (of the title when there is none)


@dataclass(frozen=True)
class Minutes:
    session_date: date | None
    session_type: str | None
    items: list[MinutesItem]
    has_text: bool


def _starts(text: str) -> list[tuple[int, int, int]]:
    """(start of the item, offset of its title, item number) for each item. A "PUNCTUL n"
    heading starts the item (it can carry the outcome: "PUNCTUL 40 - RESPINS") and gives its
    number to the numbered title right after it."""
    numbered = [(m.start(), m.end(), int(m.group(1))) for m in _NUMBERED.finditer(text)]
    out: list[tuple[int, int, int]] = []
    used: set[int] = set()
    for m in _POINT.finditer(text):
        title = _TITLE_START.search(text, m.end(), m.end() + 400)
        if not title:
            continue
        for start, _, _ in numbered:
            if m.end() <= start < title.start():
                used.add(start)
        out.append((m.start(), title.start(), int(m.group(1))))
    for start, n_end, number in numbered:
        if start not in used and not any(abs(t - n_end) < 3 for _, t, _ in out):  # noqa: PLR2004
            out.append((start, n_end, number))
    return sorted(out)


_ANCHOR = re.compile(r"(?i)adoptat|aprobat|respins|retras|am[âa]n|[îi]ntrunit")


def _page(text: str, offset: int) -> int:
    return text.count("\f", 0, offset) + 1


def _without_page_numbers(page: str) -> str:
    """Drops a page number standing alone on the first or last line of a page, so a title running
    across pages doesn't pick it up ("str. Institutului 29 f.n.")."""
    lines = page.split("\n")
    filled = [i for i, line in enumerate(lines) if line.strip()]
    for i in (filled[:1] + filled[-1:]) if filled else []:
        if re.fullmatch(r"\s*(?:-\s*)?\d{1,3}(?:\s*-)?\s*", lines[i]):
            lines[i] = ""
    return "\n".join(lines)


def parse_minutes(pages: list[str]) -> Minutes:
    # Pages join without a blank line, so a title running across a page break stays whole.
    text = "\f".join(_without_page_numbers(p).strip() for p in pages)
    if len(re.sub(r"\s", "", text)) < 200:  # noqa: PLR2004
        return Minutes(None, None, [], has_text=False)
    starts = _starts(text)
    items: dict[int, MinutesItem] = {}
    for i, (begin, start, number) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else min(len(text), start + 4000)
        segment = text[start:end]
        cut = _TITLE_END.search(segment, 40)
        title = re.sub(r"\s+", " ", segment[: cut.start() if cut else 600]).strip()
        plan = _PLAN.search(fold(title))
        if not plan:
            continue
        before = items.get(number)
        if before is not None and before.vote.outcome is not None:
            continue  # read with its outcome; an agenda listing at the start has none
        body = cut.start() if cut else min(len(segment), 600)
        # The heading's own words ("PUNCTUL 40 - RESPINS") come first; the last sentence wins.
        heading = text[begin:start] if begin < start else ""
        vote = read_vote(segment[body:])
        anchor = start  # the title's page, unless the outcome is written elsewhere
        found = list(_ANCHOR.finditer(segment, body))  # the last one is the final vote
        if vote.outcome is not None and found:
            anchor = start + found[-1].start()
        elif heading:
            vote = read_vote(heading)
            anchor = begin if vote.outcome is not None else anchor
        items[number] = MinutesItem(
            number=number,
            text=redact(title),
            kind=_KIND[plan.group(1).lower()],
            vote=vote,
            page=_page(text, anchor),
        )
    head = text[:1200]
    return Minutes(
        session_date_from_text(head),
        session_type_from_text(head),
        sorted(items.values(), key=lambda x: x.number),
        has_text=True,
    )


_INITIATOR = re.compile(
    r"(?P<lead>,?\s*(?:av[âa]nd\s+ca\s+)?(?:ini[țţt]iator|beneficiar|solicitant)\w*"
    r"(?:\s*/\s*beneficiar\w*)?(?:\s+pe)?\s*:?\s*)(?P<who>.*?)(?P<tail>[.;]?\s*$)",
    re.I,
)


def redact(title: str) -> str:
    """Replaces a private initiator's name with "persoană fizică" (PLAN §11); companies and
    public bodies stay. "X prin Y S.R.L." keeps only the company."""
    m = _INITIATOR.search(title)
    if not m or not m.group("who").strip():
        return title
    who = m.group("who").strip()
    if looks_like_organisation(who):
        via = re.search(r"\bprin\s+(.+)$", who, re.I)
        kept = via.group(1) if via and looks_like_organisation(via.group(1)) else who
    else:
        kept = "persoană fizică"
    return f"{title[: m.start('who')]}{kept}{m.group('tail')}"


def without_initiator(title: str) -> str:
    return _INITIATOR.sub("", title).strip(" ,.")


def initiator(title: str) -> str | None:
    m = _INITIATOR.search(title)
    if not m:
        return None
    who = m.group("who").strip(" ,")
    return who if who and looks_like_organisation(who) else None


_QUOTED = re.compile(r"[\"“”„«]\s*(.+?)\s*[\"“”»]", re.S)
_PLAN_PREFIX = re.compile(
    r"^(?:[îi]ntocmire\s+|finalizare\s+)?p\.?\s?u\.?\s?[gzd]\.?\s*(?:[-–:,]\s*)?", re.I
)


def plan_title(text: str) -> str:
    """The plan's own name from a draft decision's title: the quoted part without "P.U.Z. -",
    plus the place when it follows the quotes ("…”, str. Turnului nr. 5")."""
    head = without_initiator(text)
    q = _QUOTED.search(head)
    if q:
        core = q.group(1)
        tail = head[q.end() :].strip(" ,.")
    else:
        plan = re.search(r"p\.?\s?u\.?\s?[gzd]\b\.?", head, re.I)
        core = head[plan.start() :] if plan else head
        tail = ""
    core = _PLAN_PREFIX.sub("", core.strip()).strip(" ,.-–")
    tail = re.sub(r"^(?:[îi]n\s+)?(?:mun(?:icipiul|\.)?\s+bra[șş]ov\s*,?\s*)", "", tail, flags=re.I)
    tail = tail.strip(" ,.")
    title = f"{core}, {tail}" if tail and fold(tail) not in fold(core) else core
    return title[:1].upper() + title[1:]
