# ADR 0001: Monorepo toolchain

- Status: accepted
- Date: 2026-11-20
- Milestone: M1.1

## Context

PLAN §4 puts the TypeScript web app and the Python pipeline in one repo, joined only through the Postgres schema. M1.1 needs a scaffold that both halves can be built and tested in, locally and in CI.

## Decision

- **pnpm workspaces** (`apps/*`, `packages/*`), with the pnpm version pinned in `packageManager`. `minimumReleaseAge` blocks package versions published less than 14 days ago, and install scripts are denied unless listed in `allowBuilds`.
- **TypeScript 6.0, strict**, from a shared `tsconfig.base.json`. Not 7.0 yet, because typescript-eslint supports only `<6.1`.
- **Next.js 16 App Router** in `apps/web`, with **next-intl** from day one (CLAUDE.md requires every UI string to go through it). Locale routing waits for the public pages (M4).
- **Vitest + Testing Library** for unit tests. Playwright e2e is deferred to M4.1, when there are real pages to test end to end.
- **ESLint 10 (flat config) + typescript-eslint + the Next.js and react-hooks plugins**, with **Prettier** for formatting and `eslint-config-prettier` so the two don't conflict.
- **uv** for the Python project in `pipeline/`, with Python 3.12 pinned in `.python-version`, `exclude-newer = "2 weeks"` to match pnpm's release-age rule, and a `src/mdu/` package layout. Imports read `mdu.core`, `mdu.adapters.brasov`, which avoids a generic top-level `core` package. This is a small deviation from the PLAN §13 tree.
- **Ruff** (lint and format), **mypy --strict** and **pytest** for Python.
- **GitHub Actions** `ci.yml` with separate `web` and `pipeline` jobs, on pushes and PRs to `development` and `main`.

## Consequences

- One `pnpm install` and one `uv sync` set up the whole repo. The two toolchains don't share any configuration.
- The 14-day release-age rule delays urgent security fixes. Override it per package with `minimumReleaseAgeExclude` when needed.
- Moving to TypeScript 7 waits for typescript-eslint to support it.
