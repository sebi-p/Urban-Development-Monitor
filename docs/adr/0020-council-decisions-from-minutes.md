# ADR 0020: Council decisions from the session minutes

- Status: accepted
- Date: 2026-11-23
- Milestone: M5.3

## Context

Back-filled projects (M5.1) come from notices and stay "in preparation" for good: nothing told
the pipeline what the council later decided. The adopted-decisions register is behind Cloudflare
Turnstile (docs/sources), so the council's minutes are the only crawlable record of outcomes.
`CMBV-PV-<n>.pdf` is numbered sequentially. A survey of every set of minutes from July 2018 to
September 2026 (197 files, 2026-11-23) found that:

- all but four files have a text layer;
- each set of minutes lists every agenda item with the committees' opinion and the outcome. The
  wording varies over the years: "a fost adoptat cu unanimitate de voturi", "adoptat 16 voturi si
  10 abtineri", "în urma votului a fost aprobat în unanimitate", headings like "PUNCTUL 40 -
  RESPINS", and "13 voturi pentru și 13 abțineri, se amână";
- **the minutes never give the number the adopted decision received.** The maintainer agreed to
  drop the HCL number from M5.3's done criterion. A Law 544/2001 request for an export was
  declined on 24.11.2026, so the numbers stay unknown.

## Decision

- **`brasov.council_minutes`** (an events adapter in the daily run) stores the minutes it hasn't
  stored yet: first those on the listing, then older numbers, 40 per run, down to the first
  session before 2020. About 180 sets of minutes cover 2020 to today. A file published under two
  numbers is stored once.
  - The minutes PDFs are kept private in R2: they name private initiators, so the public site
    links to the city's copy, with `#page=N`.
  - Raw page text is used (`core.extract.raw_page_texts`). The shared extractor's
    header/footer removal would delete "cu unanimitate de voturi." where it ends a page.
- **Parser** (`council_minutes.parse_minutes`, rules, no AI). It splits the minutes into items
  ("PUNCTUL n" headings, numbered draft decisions, including at the top of a page), and keeps the
  items about a PUG, PUZ or PUD documentation. It reads the outcome from the last decision
  sentence (amendments are voted on first), or else from the heading. It reads the counts, in
  digits or words, also when they are in brackets after the sentence. It cites the page of the
  final vote.
  - Private initiators' names are replaced by "persoană fizică" before storing; "X prin Y
    S.R.L." keeps only the company.
- **Storage.** The existing `council_session` and `agenda_item` tables are used. Migration 0009
  adds `page`, `unanimous` and `votes_absent` ("neparticipări") to `agenda_item`. No enum
  changes.
- **`decisions` stage** (`mdu.decisions`, generic, after the linker; `mdu run --stage decisions`):
  1. Each unplaced item is scored against the projects with the linker's `score`. The title
     compared is the draft decision's title without the initiator, because project titles are
     worded the same way.
     - At `AUTO` (0.85) the item is placed on the project.
     - From `REVIEW` (0.6) it goes to the admin review queue (`link_candidate`, subject
       `minutes:<agenda_item id>`). An item whose title is close (≥0.6) to a project's goes
       there too, when neither has a street.
     - Otherwise an adopted or rejected plan becomes a project of its own, unless its text names
       a person or a single private home.
     - The linker merges a project made from the minutes into a matching listing project, never
       the other way round, because the listing project has the documents and the parcel
       location.
     - Initiators listing several companies count as the same when they share one.
  2. One `council_vote` event per placed item, rewritten from `agenda_item` each run, so it is
     idempotent. For example: "Aprobat în ședința Consiliului Local din 25.09.2026 (16 pentru, 10
     abțineri)". An item with no recorded outcome becomes a "Pe ordinea de zi" event.
  3. Status. A project takes its family's latest decision:
     - an adoption gives "approved", unless the project is further on;
     - a rejection or withdrawal applies only to a project the council hasn't decided. It may
       concern a later change to an approved plan, or come before an adoption still in review.
     - Listing re-reads never move a decided project back (`mdu.ingest`).
- **Review.** Approving a minutes candidate in `/admin` sets `agenda_item.project_id`. The next
  daily run writes the event and the status.

## Consequences

- **Survey coverage.** 237 planning items. 231 have an outcome. The other 6 have none in the
  text: committee opinions only, or an item turned into information without a vote.
- **Golden set.** `minutes_golden.json` was checked by hand against the text. It holds 82 items
  in 19 sets of minutes (2013, 2020–2026) and 11 linker golden-set projects:
  - 6 get their decisions automatically;
  - 5 go to review, where the minutes name no company or only private initiators on the same
    street;
  - no item lands on a wrong project.
- **Not here.** HCL numbers (the city declined an export), votes per councillor, and decisions other
  than urban plans.
