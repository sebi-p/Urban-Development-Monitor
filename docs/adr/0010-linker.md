# ADR 0010: Linker, scored matches with a review queue

- Status: accepted
- Date: 2026-11-22
- Milestone: M3.3

## Context

The same plan can reach the site several times: a notice while it is being prepared, a public debate later, and a folder on the urbanism hub page. PLAN §7 stage 6 links them: identifiers first, then scored candidates, with automatic links above 0.85, review between 0.6 and 0.85, and a new project below. Hub folder names can name private applicants, so a folder can be described only by its documents.

## Decision

- **Schema (migration 0005):**
  - `project.merged_into_id`: a merged project stays, so its source keeps updating it, but it is hidden, and its events and documents show on the project it joined.
  - `link_candidate`: subject, candidate, score, signals and state (`pending_review`, `auto_published`, `approved`, `rejected`). It is the review queue for the admin (M3.5).
- **Subjects:**
  - Projects that haven't been merged.
  - Groups of hub documents (a folder, known only by a hash of its name) whose files belong to no project yet.
  - A folder is described by field extraction on its memoriu, regulations and announcement (prompt `fields-v2`, which also returns the title and address). Its identifiers come from regular expressions. Its street and location come from the street index.
  - A folder already linked sends its new files to the same project, without being scored again.
- **Score** (`mdu.linker.score`):

  | Signal                              | Weight     |
  | ----------------------------------- | ---------- |
  | Shared CU number                    | +0.6       |
  | Shared CF or cadastral number       | +0.5       |
  | Same street                         | +0.45      |
  | Same house number                   | +0.2       |
  | Different house number              | −0.3       |
  | Title similarity (word overlap)     | up to +0.3 |
  | Same organisation as initiator      | +0.2       |
  | Different organisation as initiator | −0.2       |
  - A shared identifier is strong evidence but not proof: documents cite other plans' certificates and neighbouring parcels. A memoriu on the hub cites 82 identifiers and shared a CU with an unrelated plan.
  - PUD vs PUZ never matches.
  - A different street, or more than 1 km apart, caps the score below the review threshold.

- **Decisions:**
  - **A folder** at 0.85 or more is attached to the project (`project_document`). From 0.6 to 0.85 it waits for review. Below 0.6 it becomes a new project (status "in preparation", titled from its documents) unless the title names a person or a single private home (PLAN §11).
  - **Two projects** at 0.85 or more are merged, the earlier procedure stage into the later one. From 0.6 to 0.85 they wait for review. A pair a reviewer rejected is never merged again.
- **In the daily run:** link runs after fields, and fields runs once more so new or joined projects get their indicators the same day (mostly cached).
- **On the site:** merged projects are hidden from the list and the map. Their events and files show on the project they joined. Attached files the listing doesn't name are shown by their document type.
- **Golden set:** `tests/fixtures/brasov/linker_golden.json` holds profiles of all 39 subjects on 2026-11-22: 26 projects and 13 hub folders. Identifiers are hashed; titles and initiators are the privacy-checked values. It also holds the expected decision per subject: 2 folders attach to their debate projects, 11 become new projects, and one pair (two Strada Plugarilor plans by the same owners) goes to review. CI checks that exactly these links are made automatically.

## Consequences

- Hub plans appear on the site with the debate projects. Plans seen in two places show once.
- Weights are hand-set from one city's data; the review queue catches what they miss until the admin exists (M3.5).
- A new project's title comes from its documents and may read less cleanly than a listing title.
