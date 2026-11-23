# Design guide

How the site looks and behaves. The live version, rendered from the code, is at `/stil`. Tokens are in `apps/web/app/globals.css` (`@theme`), status groups in `apps/web/lib/status.ts`, and components in `apps/web/components/` (`ui/` holds the generic ones, in the shadcn/ui style). ADR 0014 records the decisions.

## Principles

1. **An app, not a document.** The map fills the screen and everything else floats over it: the app bar on top, a bottom sheet on phones, a side panel on wide screens.
2. **Phones first.** Most visitors arrive from a link shared in a neighbourhood Facebook or WhatsApp group. Touch targets are at least 44 px high (`min-h-11`); chips may be 36 px inside a scrolling row. Nothing scrolls sideways at 360 px.
3. **Calm, so the data stands out.** Neutral greys and one accent colour. The status colours are the only strong colours, on the map and in the badges.
4. **Never colour alone.** Every status has an icon and a label as well as a colour. Text meets WCAG AA (4.5:1); pins and icons meet 3:1 against the map.
5. **Works without JavaScript, better with it.** Filters are a plain form and the list is in the first HTML response. The map, the sheet's drag and the instant filters are enhancements.
6. **Sources visible.** Every extracted value links to its page in the city's PDF, and official sources are named. Automatic values say so (a `title` on the indicators).

## Colour

| Token                         | Value                                      | Use                                                                     |
| ----------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| `accent-700`                  | `#0f766e` (deep teal)                      | Links, primary buttons, selected chips, the brand mark (5.5:1 on white) |
| `accent-800`                  | `#115e59`                                  | Hover on primary                                                        |
| `accent-50 … 200`             | tints                                      | Rare highlights                                                         |
| `slate-50`                    | page background                            |                                                                         |
| `slate-900 / 700 / 600 / 500` | text: titles / body / secondary / meta     | `slate-500` is the lightest text allowed (4.8:1)                        |
| `slate-200 / 300`             | borders, dividers, unselected chip borders |                                                                         |

### Status groups

Fourteen statuses fall into seven groups. The pin colour is used on the map and in icons; the text colour is used for badge labels on a light tint of the pin colour.

| Group        | Statuses                                          | Pin       | Text      | Icon             |
| ------------ | ------------------------------------------------- | --------- | --------- | ---------------- |
| Preparation  | announced, in preparation, under committee review | `#7c3aed` | `#6d28d9` | `FilePen`        |
| Consultation | in public consultation                            | `#ea580c` | `#c2410c` | `MessagesSquare` |
| Council      | on the council agenda, debate closed (`expired`)  | `#b45309` | `#92400e` | `Landmark`       |
| Approved     | approved, permitted                               | `#15803d` | `#166534` | `CircleCheck`    |
| Construction | under construction, completed                     | `#1d4ed8` | `#1d4ed8` | `HardHat`        |
| Closed       | rejected, withdrawn, annulled                     | `#64748b` | `#475569` | `CircleSlash`    |
| Contested    | contested in court                                | `#be123c` | `#be123c` | `Scale`          |

Clusters are dark slate (`#1f2937`) with a white count, so they never read as a status.

## Typography

Inter, self-hosted through `next/font` with `latin-ext` (ș, ț, ă, â, î), with the system font as fallback.

| Use                        | Size / weight                          |
| -------------------------- | -------------------------------------- |
| Page title                 | 30 px / 600 (`text-3xl font-semibold`) |
| Section                    | 20 px / 600                            |
| Card title                 | 16 px / 600, `leading-snug`            |
| Body                       | 16 px / 400                            |
| Secondary                  | 14 px, `slate-600`                     |
| Meta (type, date, sources) | 12 px, `slate-500`                     |

Headings use tight letter spacing (`tracking-tight`). Text is never smaller than 12 px.

## Shape, depth, spacing

- **Corner radius:** cards 16 px (`--radius-card`), the sheet or panel 20 px (`--radius-sheet`), buttons and chips fully rounded, small tags 6 px.
- **Shadows:** `--shadow-card` (subtle) for cards on the page; `--shadow-panel` (soft, deep) for anything floating over the map.
- **Spacing:** Tailwind's 4 px scale. Card padding 16 px, gaps 8–12 px, page gutters 16 px.

## Components

| Component    | Where                   | Rules                                                                                                                                                                                                                                     |
| ------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App bar      | every page (`AppBar`)   | 56 px, white with a blur over content, brand mark + product name + city; actions on the right                                                                                                                                             |
| Button       | `ui/button.tsx`         | Variants: primary (one per view), secondary, ghost, danger; sizes md (44 px), sm (36 px), icon                                                                                                                                            |
| Chip         | filters (`FilterChips`) | A checkbox covering the whole chip; selected = accent fill; status chips carry their icon; one scrolling row                                                                                                                              |
| Status badge | `StatusBadge`           | icon + label in the group's text colour on its tint; never just a dot                                                                                                                                                                     |
| Badge        | `ui/badge.tsx`          | Neutral tags: plan type, indicators (`rounded-md`), linked to their source page                                                                                                                                                           |
| Card         | project list            | status badge, type · date, title, address with location precision, indicators, initiator, documents in a disclosure                                                                                                                       |
| Bottom sheet | `BottomSheet`           | Phones: peek (count + chips), half, full; drag the handle or use the Listă/Hartă button; `#p-…` links open it full. Wide screens: a floating 26 rem panel on the left                                                                     |
| Map          | `ProjectMap`            | OpenFreeMap "liberty" base, clusters with click-to-zoom, pins with a white outline, popups with a link to the card and the project page                                                                                                   |
| Project page | `components/project/*`  | Header (status, title, address), consultation box first while open, summary card with its source chip, figures with page links, timeline (hollow dot = still to come), documents, small map loaded on scroll, nearby list, "last checked" |

## Words

- **Romanian is the default** (`messages/ro.json`), English second. All UI text goes through the message files.
- **Plain words** for residents: "În consultare publică", "Dezbatere încheiată", "Mai multe filtre". Legal terms (PUZ, PUD, POT, CUT) are kept, because people search for them.
- **Say where data comes from:** "locație exactă (din coordonatele planului)", "Sursa oficială:", "Valori extrase automat…".

## Not yet

Dark mode (tokens are ready for a second set), a "near me" button, neighbourhood filters, skeleton loading states.
