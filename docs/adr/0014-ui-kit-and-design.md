# ADR 0014: UI kit, design guide and app layout

- Status: accepted
- Date: 2026-11-22
- Milestone: M4.0, added before M4.2 at the maintainer's request

## Context

PLAN §4 picked Tailwind CSS, shadcn/ui and lucide icons, and §8 described a mobile-first app: a full-screen map with a side panel, or a bottom sheet on phones. Until now the site used a few hand-written styles. The maintainer asked for a style guide that feels like a real app, applied before more pages are built. There was no reference design, so a calm civic look was chosen; dark mode comes later.

## Decision

- **Tailwind CSS 4.3** (MIT) through `@tailwindcss/postcss`. Design tokens are CSS variables in `@theme` (`apps/web/app/globals.css`): one deep-teal accent, slate neutrals, seven status-group colours, radii, shadows and the app bar height.
- **shadcn/ui-style components, written into the repo:** `components/ui/` holds button, badge and card, using `class-variance-authority`, `clsx` and `tailwind-merge` (all MIT). The shadcn CLI isn't used: it fetches its latest release and registry at run time, which would bypass the two-week package-age rule (ADR 0001). No Radix packages are needed yet.
- **lucide-react** (ISC) for icons. Each status group has one, so status is never shown by colour alone.
- **Inter** via `next/font`, self-hosted at build time with the `latin-ext` subset for Romanian.
- **Layout:**
  - A 56 px app bar.
  - On the city page the map fills the screen. Phones get a bottom sheet with three heights (peek, half, full) that can be dragged, or opened with a Listă/Hartă button. Wide screens get a floating side panel. The sheet replaces the M4.1 tabs.
  - Filters become chips (checkboxes covering the whole chip) in the sheet header, with years and "consultation open" under "More filters".
  - They stay one GET form through the HTML `form` attribute, so they work without JavaScript. With JavaScript the Apply button is hidden.
- **Contrast checked:** badge text uses a darker shade of each group colour (all at least 4.7:1 on its tint). Pins keep the brighter colour (3.1–5.8:1 against the map, at least 3:1 for graphics).
- **The guide** is `docs/design.md`, and a live `/stil` page renders every token and component (not indexed). The admin area uses the same components.

## Consequences

- New pages (M4.2–M4.4) build on the same tokens and components.
- The 3G phone budget still passes: on 2026-11-22, filters at 0.34 s, pins at 4.7 s (3.3 s before, mostly the font) and the list opens in 0.08 s. The JavaScript added is small (class helpers and the icons used).
- A second token set for dark mode can be added under a media query later.
