# ADR 0004: Collection client, pipeline dependencies and fixture policy

- Status: accepted
- Date: 2026-11-20
- Milestones: M0.1 (pulls part of M2.1 forward)

## Context

CLAUDE.md requires all live requests to go through `mdu.core.http`, so it must exist before Phase 0 fetches anything. Fixtures are raw HTML and PDFs from municipal sites. They can include personal data, such as applicant names (sometimes even in folder names and URLs) and residents' comments, and architects' copyrighted documentation. The repo is public, and the maintainer's rule is that only data processed by the app may be committed, never raw files.

## Decision

- **`mdu.core.http.PoliteClient`** (on `httpx`, with HTTP/2) enforces the PLAN §7 politeness rules:
  - robots.txt per host, following RFC 9309. A 4xx means allowed; a 5xx or network error means disallowed for 10 minutes. Up to 5 redirects are followed for robots.txt.
  - a host block list from the jurisdiction config;
  - redirects followed by hand, so every hop is checked and throttled;
  - at least 2.5 s between requests to one host;
  - a User-Agent naming the project URL and `urban-development-monitor@pm.me`;
  - exponential back-off that honours `Retry-After`;
  - conditional GET;
  - a maximum download size;
  - a stop after 20 consecutive failures.
- **Extra pipeline dependencies:**
  - `boto3`, for R2 through its S3 API (with `boto3-stubs` for mypy);
  - `pyyaml`, for the jurisdiction config.
- **Raw fixtures live only in private R2,** under `fixtures/<city>/<sha256>.<ext>`, with a private `<sha256>.meta.json` holding the URL and headers. The local cache `pipeline/tests/fixtures/<city>/files/` is gitignored.
- **The committed `manifest.json`** holds only the ID, source, fetch time, status, content type, size, SHA-256 and a neutral note. It holds **no URLs**, because folder names can contain personal names.
- **Commands:** `mdu fixtures capture | push | pull | verify` manage fixtures; `mdu fetch` downloads pages to a local folder for exploration.
- **Tests read fixtures through `mdu.fixtures.fixture_bytes`.** It skips a test when the file isn't cached locally, and fails instead when `MDU_REQUIRE_FIXTURES=1`, which CI sets.
- **Capture rules:** capture only what tests need, prefer company- or city-initiated projects, and never capture registers of residents' opinions or very large plan sheets.

## Consequences

- Running fixture-based tests locally needs R2 credentials in `.env`; without them those tests skip. CI pulls fixtures using the repository secrets.
- Golden extraction files (M3) are processed output and may be committed. They must still be checked for personal data first, and private individuals appear only as "persoană fizică" (PLAN §11).
- PyMuPDF (PLAN §4) is AGPL-licensed. Adding it in M2.3 effectively commits the pipeline to AGPL-3.0, which is one of the two licences PLAN §11 allows. That's to be confirmed before M2.3.
