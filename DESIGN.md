---
name: "DiffSlice"
description: "A dark LOC-weighted code atlas with on-demand source comparison."
colors:
  ink: "#e5ebf3"
  muted: "#a3b0c2"
  support: "#b4c3d6"
  canvas: "#101419"
  surface: "#161c24"
  surface-low: "#131a22"
  rule: "#303b49"
  rule-strong: "#39475a"
  accent: "#8bb5ff"
  primary: "#719fed"
  primary-hover: "#94baff"
  primary-ink: "#0b1728"
  brand-bg: "#243d5a"
  brand-ink: "#b7d3ff"
  control-hover: "#2a3545"
  map-bed: "#0c1117"
  added: "#8ed5a7"
  deleted: "#f1a2af"
  changed: "#efc47f"
  addition-wash: "#152f26"
  addition-ink: "#cfe9db"
  deletion-wash: "#3a2027"
  deletion-ink: "#f5cbd3"
  tree-selected: "#263e5b"
  tree-selected-ink: "#e1edff"
  tree-hover: "#253244"
  search-bg: "#111820"
  search-results-bg: "#1b2532"
  search-results-hover: "#2c3c51"
  search-results-rule: "#43536b"
  revision-bg: "#232d3a"
  hunk-bg: "#1e2b3d"
  hunk-ink: "#b9d3fa"
  switch-bg: "#10161e"
  switch-active: "#293c54"
  switch-active-ink: "#d1e3ff"
  diff-header-bg: "#1a2431"
  diff-revisions-bg: "#18222e"
  no-changes-bg: "#1c2d27"
  no-changes-ink: "#bedbc9"
  error-bg: "#3b252c"
  info-bg: "#1b293a"
  info-ink: "#b7c9df"
  tile-hover-outline: "#aecbff"
  tile-focus-outline: "#a6c8ff"
  selection-bg: "#33577e"
  selection-ink: "#ffffff"
  tile-badge-bg: "#171a20"
  legend-neutral: "#7e91aa"
  tile-slate-bg: "#202b38"
  tile-slate-rule: "#3d4c5d"
  tile-slate-ink: "#dae3ee"
  tile-sage-bg: "#243234"
  tile-sage-rule: "#3e5453"
  tile-sage-ink: "#d5e4e0"
  tile-sand-bg: "#302f2a"
  tile-sand-rule: "#555044"
  tile-sand-ink: "#e5e1d4"
  tile-blue-bg: "#253142"
  tile-blue-rule: "#40556f"
  tile-blue-ink: "#d7e4f7"
  tile-mauve-bg: "#2f2939"
  tile-mauve-rule: "#51475e"
  tile-mauve-ink: "#e6dcee"
  tile-teal-bg: "#233237"
  tile-teal-rule: "#3e5861"
  tile-teal-ink: "#d3e5eb"
  tile-changed-bg: "#3b3020"
  tile-changed-rule: "#a17a3d"
  tile-changed-ink: "#ffe0a6"
  tile-added-bg: "#203b2f"
  tile-added-rule: "#478e68"
  tile-added-ink: "#b5f0c9"
  tile-deleted-bg: "#40292f"
  tile-deleted-rule: "#a35a68"
  tile-deleted-ink: "#ffc3ce"
typography:
  brand: {"fontFamily": "'Manrope Variable', sans-serif", "fontSize": "21px", "fontWeight": 800, "letterSpacing": "-.035em"}
  body: {"fontFamily": "'Manrope Variable', sans-serif", "fontSize": "13px"}
  title: {"fontFamily": "'Manrope Variable', sans-serif", "fontSize": "14px", "fontWeight": 750}
  label: {"fontFamily": "'Manrope Variable', sans-serif", "fontSize": "13px", "fontWeight": 650}
  tile-title: {"fontFamily": "'Manrope Variable', sans-serif", "fontSize": "13px", "fontWeight": 750}
  tree: {"fontFamily": "'Manrope Variable', sans-serif", "fontSize": "12px"}
  metadata: {"fontFamily": "'Manrope Variable', sans-serif", "fontSize": "11px"}
  code: {"fontFamily": "'Cascadia Code', Consolas, monospace", "fontSize": "12px", "lineHeight": 1.7}
rounded:
  preview: "2px"
  row: "4px"
  tile: "4px"
  icon: "5px"
  control: "6px"
  map: "7px"
  switch: "7px"
  brand: "8px"
  popover: "8px"
spacing:
  micro: "3px"
  tight: "4px"
  compact: "6px"
  small: "8px"
  control: "11px"
  inset: "14px"
  map: "16px"
  section: "18px"
  page: "24px"
components:
  button-primary: {"backgroundColor": "{colors.primary}", "textColor": "{colors.primary-ink}", "typography": "{typography.label}", "rounded": "{rounded.control}", "height": "33px", "padding": "0 11px"}
  button-primary-hover: {"backgroundColor": "{colors.primary-hover}"}
  button-secondary: {"backgroundColor": "{colors.surface}", "textColor": "{colors.ink}", "typography": "{typography.label}", "rounded": "{rounded.control}", "height": "33px", "padding": "0 11px"}
  search: {"backgroundColor": "{colors.search-bg}", "textColor": "{colors.ink}", "rounded": "{rounded.control}", "height": "34px", "padding": "0 10px"}
  tree-row-selected: {"backgroundColor": "{colors.tree-selected}", "textColor": "{colors.tree-selected-ink}", "rounded": "{rounded.row}", "padding": "7px 9px"}
  diff-addition: {"backgroundColor": "{colors.addition-wash}", "textColor": "{colors.addition-ink}", "typography": "{typography.code}"}
  diff-deletion: {"backgroundColor": "{colors.deletion-wash}", "textColor": "{colors.deletion-ink}", "typography": "{typography.code}"}
  tile-slate: {"backgroundColor": "{colors.tile-slate-bg}", "textColor": "{colors.tile-slate-ink}", "rounded": "{rounded.tile}"}
  tile-sage: {"backgroundColor": "{colors.tile-sage-bg}", "textColor": "{colors.tile-sage-ink}", "rounded": "{rounded.tile}"}
  tile-sand: {"backgroundColor": "{colors.tile-sand-bg}", "textColor": "{colors.tile-sand-ink}", "rounded": "{rounded.tile}"}
  tile-blue: {"backgroundColor": "{colors.tile-blue-bg}", "textColor": "{colors.tile-blue-ink}", "rounded": "{rounded.tile}"}
  tile-mauve: {"backgroundColor": "{colors.tile-mauve-bg}", "textColor": "{colors.tile-mauve-ink}", "rounded": "{rounded.tile}"}
  tile-teal: {"backgroundColor": "{colors.tile-teal-bg}", "textColor": "{colors.tile-teal-ink}", "rounded": "{rounded.tile}"}
  tile-changed: {"backgroundColor": "{colors.tile-changed-bg}", "textColor": "{colors.tile-changed-ink}", "rounded": "{rounded.tile}"}
  tile-added: {"backgroundColor": "{colors.tile-added-bg}", "textColor": "{colors.tile-added-ink}", "rounded": "{rounded.tile}"}
  tile-deleted: {"backgroundColor": "{colors.tile-deleted-bg}", "textColor": "{colors.tile-deleted-ink}", "rounded": "{rounded.tile}"}
---
# Design System: DiffSlice

## Overview

**Creative North Star: "The Dark Workbench"**

DiffSlice is a polished dark developer workbench: graphite surfaces, bright readable ink, blue actions, fine rules, and a split-square brand mark. Its code atlas uses the familiar geometry of a disk analyzer, with restrained categorical rectangles and explicit comparison colors that make source size and change status legible at a glance.

The main surface stays calm and spatial; supporting controls and the changed-file tree are compact. Source comparison appears when a changed file is selected, preserving map context above it. This is a code-led system; the implemented viewer is the authority for measurements and states.

**Key Characteristics:**

- LOC-weighted rectangles with nested previews and single-click exploration.
- Graphite surfaces, pale blue actions, muted categorical fills, and explicit change overlays.
- Compact Manrope interface type with monospace paths, hashes, and source.
- Flat structural surfaces; shadows reserved for floating search and the mobile sidebar.

## Colors

The palette combines graphite surfaces, cool blue interaction states, and low-saturation atlas regions. Frontmatter contains the normative values extracted from `src/viewer/styles.css`, including its later Dark workbench overrides. Dark mode is the default in both the live viewer and exported HTML; `scripts/build.mjs` also declares the dark color scheme.

### Primary

- **Workbench blue** (`accent`): keyboard focus and selected-map outline. The historical CSS variable `--green` also holds this blue; its name does not signify a green interaction theme.
- **Action blue** (`primary`, `primary-hover`, `primary-ink`): export action, with dark text for contrast. The brand uses `brand-bg` and `brand-ink`.
- **Supporting ink** (`support`, `muted`): secondary labels, metadata, search placeholder, scope separators, and footer information.

### Secondary

- **Atlas tones** (`tile-slate-*`, `tile-sage-*`, `tile-sand-*`, `tile-blue-*`, `tile-mauve-*`, `tile-teal-*`): unchanged regions. Each uses a background, rule, and ink triplet. The deterministic category choice comes from module identity or path; these colors do not encode file status or size.
- **Comparison tones** (`tile-changed-*`, `tile-added-*`, `tile-deleted-*`): amber for mixed/modified areas, green for wholly added areas, and rose for wholly deleted areas. Nested preview blocks use their own status tones.
- **Signed deltas** (`added`, `deleted`): numerical additions/deletions in the review bar, sidebar, and selected-file details. Diff row washes use `addition-wash` and `deletion-wash`; signs and line numbers carry meaning alongside color.

### Neutral

- **Graphite surfaces** (`canvas`, `surface`, `surface-low`, `map-bed`): page and map stage, controls/sidebar, summary/footer, and the treemap's recessed field.
- **Ink and rules** (`ink`, `muted`, `rule`, `rule-strong`): reading hierarchy and thin structural dividers.
- **Context surfaces** (`search-bg`, `revision-bg`, `hunk-bg`, `hunk-ink`, `tree-*`): identify searchable input, revision metadata, hunk boundaries, and the active file row.

**The Independent Channels Rule.** Area communicates source size; color communicates comparison status. Keep these two signals independent.

## Typography

**Interface font:** Manrope Variable, sans-serif fallback, bundled through `@fontsource-variable/manrope`.
**Source font:** Cascadia Code, Consolas, monospace; code ligatures disabled.

The compact sans-serif keeps the atlas and tree readable without dominating the geometry. Monospace identifies source, revision hashes, and the selected file path.

- **Brand:** (21px, weight 800, tracking -.035em); compact screens use (19px).
- **Pane title:** (14px, weight 750), used for the changed-files heading.
- **Controls:** (13px, weight 650); map headers use (13px, weight 750), increasing to (14px) at widths from (1750px). File-tile names use (14px, weight 750). Tree names are (12px), or (11px) up to (1100px).
- **Support:** map header LOC and container summaries are (11px); file-tile LOC is (12px), paths (11px), tree deltas (10px), footer (10px). Signed counts use tabular numerals. LOC uses en-US grouped integers on files and scope summaries, and compact en-US notation with at most one decimal in container headers and nested previews.
- **Source:** (12px, line-height 1.7); wide screens from (1750px) use (14px), compact screens use (13px, line-height 1.65). Revision labels and diff paths use monospace. Compact diff paths, revisions, and hunk headers use (10px).
- **Body:** root size (13px); loading and diff messages use (14px). Explanatory map details use (13px, line-height 1.7), or (11px) on compact screens. Compact tile titles are (11px), preview metadata (10px), and footer labels (9px).

## Layout

The application fills the viewport (100dvh), with a minimum height of (540px), increased to (560px) on compact screens. Header (64px), review summary (40px minimum), toolbar (58px), and footer (35px minimum) surround a flexible workspace. The atlas is the dominant surface, spanning the workspace until a diff is requested. A breadcrumb row (57px) and hover/scope description row (53px) frame the treemap; horizontal stage inset is (16px).

The optional right changed-file tree has its own vertical scrolling. Its desktop width is (340px), reduced to (300px) at widths up to (1100px), and expanded to (360px) from (1750px). It initializes open above a viewport width of (900px), then remains user-controlled. Closing it returns the width to the atlas.

Selecting a changed file opens a bottom drawer within the main stage. The desktop split is (44% map / 56% diff) with a map minimum of (180px). The sidebar spans the full workspace height alongside both. Closing the diff restores the full-height map. Before and After share equal columns inside an internally scrolling patch surface with a minimum width of (1100px); the narrow viewport reveals portions of that surface through horizontal scrolling.

At widths up to (760px), the header becomes (58px), review summary (36px), and toolbar (91px) with two rows: hierarchy switch and tree toggle above search and Changes only. Header actions become icon-sized controls. The tree becomes a fixed right overlay, from (185px) below the top to (35px) above the bottom, width `min(340px, calc(100% - 30px))`. The map remains the underlying workspace. Selecting a file from navigation closes this overlay. Map breadcrumbs become (45px), supporting row (47px), and stage inset (7px). The selected-file layout uses (40% map / 60% diff), with a map minimum of (150px). Keep the code surface wide and internally scrollable; do not shrink it to a pair of unreadable columns.

At widths up to (1100px), secondary revision labels, local status, map instruction, and provenance footer give way to core controls. Breadcrumbs scroll horizontally. The mobile footer retains the four status keys and the concise Area = LOC label.

## Elevation & Depth

Structural depth comes from graphite tonal layering and one-pixel borders. The canvas and active hierarchy switch have no shadow. Floating search results use (`0 12px 32px #0006`); the compact sidebar overlay uses (`-8px 0 24px #0005`).

**The Quiet Structure Rule.** Use fine rules and tonal boundaries for the workspace. Reserve elevation for floating search and the compact sidebar overlay.

## Shapes

The split-square mark anchors the identity. Corners stay gently curved: preview rectangles (2px), main tiles, tree rows and metadata chips (4px), icon controls (5px), buttons and search (6px), treemap field and hierarchy-switch surround (7px), brand mark and search results (8px). Fine borders and closely packed rectangular regions carry the atlas geometry. Use ordinary compact rectangles rather than decorative cards.

## Components

### LOC treemap

Squarified rectangles fill the current scope with an outer inset (5px), inner gaps (4px), and reserved container-header space (39px) in the D3 layout; the visible CSS header is (37px) high. Rule-based Modules gives each physical file one primary home and uses its full physical line count at every level. Parent totals include descendants without duplicating files. Empty, binary, and unavailable files receive a minimum display weight of one; textual LOC remains the measured count, including zero. Directory view also counts each file once.

Named module rules preserve parent/child boundaries. Directly owned files of a parent with named children appear under Other files. Leaf modules with at most (12) files show files directly; larger leaf modules expose directories. Empty modules disappear. Unmatched and ambiguous files appear under Unassigned; excluded files appear only when changed, under Excluded changes. Deleted files retain base-revision ownership evaluated with the selected head rules, and renames use the destination owner.

The optional Graphify hierarchy preserves upstream communities. Only its module overview apportions shared files' display area across community memberships, including the minimum weight. Inside a Graphify module, files use their full line counts. Graphify module labels may overlap and must not be summed as independent repository totals.

Single click drills into a module or directory. Children are previewed inside their parent; the visible top-level block is the interaction target. Breadcrumbs and Go up one level reverse the drill. A changed file opens its diff; an unchanged file reports its path, LOC, and unchanged status in the supporting description. The brand button returns to the current hierarchy root and closes the diff.

Labels adapt to available area: main labels require width above (85px) and height above (38px); richer container summaries appear above (155px ? 100px). Small blocks remain geometric signals with native title information. Keyboard tab targets require width and height above (18px). Hover brightens a tile and draws an inset outline; focus uses a stronger inset outline; selected files retain a blue outline independently of their status fill. Search dims nonmatching regions to opacity (.22), without resizing them. Changes only removes unchanged descendants and recalculates the visible layout.

### Hierarchy navigation and search

Modules and Directories form a compact segmented control with an explicit pressed state. Modules uses the editable rules at the selected head commit when available, local rules for first-run reviews when absent from that commit, or an explicitly selected external rules file; the existing Graphify map remains the fallback. The same rule index maintained by the updater supplies the viewer's named hierarchy. Switching hierarchy resets breadcrumbs, search, and hover context. Search matches names and paths, returns up to (14) results with LOC, and prioritizes changed regions then source size. Results float below the field; Enter opens the first result. Selecting a file reveals its containing scope. Escape clears an active search before closing a selected diff. No-result text provides feedback inside the results panel.

### Changed-file directory tree

A collapsible right sidebar exposes changed files through a familiar folder hierarchy. Folder rows toggle expansion; file rows select the file and reveal its map context. Directory-only chains collapse into combined path labels. Folders precede files, then sort alphabetically. Indentation begins at (13px) and increases by (14px) per level. Rows have minimum height (35px), compact type, clipped names with full-path titles, and explicit signed addition/deletion totals. Selection uses the established blue surface (`tree-selected`) and pale blue ink (`tree-selected-ink`). Summary and footer remain fixed while the tree scrolls. The Files control and sidebar close button expose its open state.

### Deferred side-by-side diff

The drawer loads a patch on file selection and caches it for the session; exported HTML uses embedded patches. A path header, signed counts, previous/next controls, close action, Before/After revisions, aligned rows, and sticky hunk headers provide orientation. The patch area receives keyboard focus and scrolls in both axes. Its inner surface stays at least (1100px) wide at every viewport size, preserving usable side-by-side code. When an added file opens in a viewport narrower than the patch surface, the patch scrolls to After automatically so its populated code is visible immediately. Other file statuses reset to Before. Lines use pre-wrapped text with normal overflow wrapping rather than arbitrary identifier splitting. Additions/deletions have background washes, signs, and line numbers; absent cells use the map-stage wash.

Loading, fetch error, binary/unavailable explanatory message, renamed-without-text-changes, and no-text-hunks states occupy the drawer body. Disabled previous/next buttons communicate boundaries. The map remains above all these states.

### Buttons and fields

Primary export is action blue with dark text; hover brightens the blue. Secondary buttons use the graphite surface and fine rule, with a lighter graphite hover surface. Standard buttons are (33px) high with (6px) corners and (0 11px) padding. Disabled buttons reduce opacity to (.4). Icon controls are (30px square) with a quiet hover fill. Inputs and buttons receive a (2px) blue outline, normally offset by (3px); the search group uses a (1px) offset. Search is (34px) high with (6px) corners and (0 10px) padding.

### System feedback

An identical-tree comparison leaves the atlas available and adds a concise no-changes banner. A filtered empty scope suggests turning off Changes only. Initial loading and failure states use centered copy. Map details disclose one primary module per file for rules, or shared-file apportioning for Graphify, alongside minimum area, unavailable metrics, warnings, and provenance. The desktop footer reads Module rules | files verified at head in rule mode, or Graphify map | revision unverified in Graphify mode. Verified files establish committed file contents, not the architectural quality of rule names or boundaries. Shared-file apportioning appears in the area legend only at the Graphify module root. Export shows a pending label, disables while working, and presents failures in a dismissible alert. Offline snapshots identify themselves and disable repeat export. Loading spinners rotate over (1s linear infinite); reduced-motion preference disables animations and transitions. Tile hover uses a short brightness transition (.14s ease-out); drilling replaces scope without a decorative camera animation.

## Do's and Don'ts

### Do:

- **Do** preserve LOC weighting, nested previews, and the current breadcrumb context.
- **Do** keep signed addition/deletion counts beside file and folder names.
- **Do** leave the diff closed until a changed file is selected.
- **Do** preserve aligned before/after rows, line numbers, sticky hunk labels, and internal horizontal scrolling.
- **Do** retain visible keyboard focus, inspectable full paths, and reduced-motion support.

### Don't:

- **Don't** size blocks by edit counts or give every module equal area.
- **Don't** flatten named rule hierarchies, duplicate rule-owned files, or omit unassigned/excluded changed files.
- **Don't** apportion file area in rule mode; preserve shared-file apportioning only in the Graphify module overview.
- **Don't** substitute a node-link graph for the implemented treemap.
- **Don't** force code into narrow mobile columns by fragmenting identifiers.
- **Don't** present unverified map provenance as synchronized with the compared revisions.
