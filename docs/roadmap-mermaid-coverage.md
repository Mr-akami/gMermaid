# Mermaid coverage roadmap (2026-09-21)

**All phases below are merged.** gMermaid supports twelve diagram kinds; the
README table is the user-facing summary, this file keeps the per-kind
decisions and the deliberate gaps.

Goal was: close the gap between gMermaid and mermaid.js syntax for the four
core diagrams, then add Gantt / Requirement / Usecase / User Journey, then
Mindmap / Timeline.
Each phase = one or more PRs; every PR carries unit tests (parser round
trip, reducer, layout golden) and Playwright GUI tests under `e2e/`.

Design rules stay as in `CONTEXT.md` / ADR 0001: IR is master, layout is
auto, styling/interaction syntax (`style`, `classDef`, `click`, `%%`) is
**tolerated and dropped on import** — it has no GUI meaning here. The set is
shared by every kind (`STYLING_STATEMENTS`) and every drop is reported as a
`ParseWarning`, shown under the code pane.

## Phase 0 — test infra (done)
- Playwright harness, tab smoke test, CI step. `pnpm test:e2e`.
- Diagram-kind registry (`DIAGRAM_KINDS`, `detectDiagramKind`, `DIAGRAMS`).

## Phase 1 — parser leniency, all kinds (done)
- Frontmatter, `%%{init}%%`, trailing `%%` comments, `;` separators, bare
  `flowchart`/`graph TD;` headers, `:::class` stripped, styling/interaction
  lines dropped, `accTitle`/`accDescr` skipped, unicode / dotted ids.

## Phase 2 — core four, feature depth (done)
### Flowchart (done)
- Edge model: line style (solid/dotted/thick/invisible) × head at each end
  (none/arrow/circle/cross) → `<-->`, `--o`, `x--x`, `-.-`, `===`.
- Edge length (`--->` = dagre minlen).
- `A@{ shape: … }` parse/emit for existing shapes + new shapes
  (doc, notch-rect, text, hourglass, delay, fork, bolt, tri, flip-tri,
  sl-rect, lin-cyl, f-circ …).
- Id-less `subgraph Title`, subgraph `direction` editor.
- Guard `A--txt-->B` mis-parse.
- Mermaid can only express a SYMMETRIC head pair (`<-->`, `o--o`, `x--x`);
  a start head that differs from the end head is dropped on emit, as
  mermaid's own `destructLink` calls that combination invalid.
- Each subgraph is laid out in a dagre graph of its own and placed in its
  parent as a single node, so a subgraph honors its own `direction` and the
  rank separation no longer grows with nesting depth (an edge inside three
  frames: 350px → 50px). An edge naming a subgraph ends on its frame; one
  naming a node inside carries on to that node.
### Sequence (done)
- Activation (`+`/`-` suffix and `activate`/`deactivate`), `box`, `rect`,
  `create`/`destroy`, participant types `@{ type: … }`, multi-line notes
  (tspan + textarea), `autonumber start step` fields.
- `title` stays dropped on import, like the other styling/meta statements.
  A box holds its members contiguously, so a lifeline joining a box moves
  next to its mates; a created participant is declared by its `create` line
  only (mermaid rejects a second declaration), so it cannot sit in a box.
### State (done)
- Concurrency `--` regions, per-block `direction`, multi-line notes,
  self-transitions, `state X <<choice>>` etc. already ok.
- Each composite is laid out in a dagre graph of its own and placed in its
  parent as a single node, so a composite honors its own `direction` and the
  rank separation no longer grows with nesting depth. An empty region is not
  expressible in mermaid text, so the GUI splits an existing member into a
  new region instead.
### Class (done)
- A namespace is laid out in a graph of its own and enters the diagram as one
  node, so a frame no longer triples the rank gap around it (60px → 180px
  before). Namespaces cannot nest in mermaid, so there is one level only.
- Reversed / two-way relation tokens, `direction TD`, `classDiagram-v2`,
  `class X["label"]` + relaxed names, `*`/`$` classifiers, type-first
  attributes, inline `<<annotation>>`, generic class names, notes,
  namespaces, lollipop.
- The relation IR is `line` (solid/dashed) + a head per end, so the named
  UML kinds fall out of it (realization = dashed + inheritance head,
  dependency = dashed + arrow). Reversed tokens keep their ends in source
  order and move the head, so the token survives the round trip verbatim.
- Left out: nested and dotted namespaces (flat, one level only) — a nested
  `namespace` block is a parse error. The `*` classifier on an ATTRIBUTE is
  dropped on import: UML has no abstract field and the IR keeps `abstract`
  on methods only.

## Phase 3 — new diagram kinds (done)
Wave 1: Gantt, Requirement, User Journey.
Wave 2: Mindmap, Timeline, Usecase (`usecase-beta`, needs mermaid ≥ 12 for
validation — the dev dependency was bumped to 12.0.0).
Wave 3: ER, Architecture (`architecture-beta`; the mermaid 12.0.0 already in
the repo ships it, so no dependency bump).
Each: IR + actions, parser, codegen, layout, renderer, editor + property
window, registry entry, mermaid.js integration test, e2e spec.

### Usecase (done)
- Actors (default / hollow / awesome, business slash, stereotypes), ellipse
  and rectangular use cases, `systemBoundary` blocks (`@{ type: package }`,
  quoted titles with mermaid's derived identifier), every association
  operator (`-->`, `<--`, `--`, `--o`, `o--`, `--x`, `x--`, `--|>`),
  labelled associations, `..> : include|extend`, `note for`, `direction`.
- The relation IR is `line` + a head per end plus an optional include/extend
  `kind`; the reducer normalizes it to what mermaid can actually spell (one
  marker per relation, generalization only in the `--|>` direction,
  include/extend dashed, unlabelled and markerless).
- A systemBoundary is laid out in a graph of its own and enters the diagram
  as one node, so a frame no longer triples the rank gap around it (55px →
  165px before). Relation labels are sized for dagre, as elsewhere.
- Left out (tolerated on import, dropped): `json` tables (the whole block is
  skipped), icon actors, explicit edge ids and their `animation` / `animate`
  metadata, extra-dash edge length, `classDef` / `class` / `style` / `:::`.

### ER (done)
- `erDiagram`: entities with `type name PK|FK|UK, … "comment"` attributes
  (reorderable in the property window), `A["alias"]` display names, all four
  cardinalities per end, identifying `--` and non-identifying `..` lines,
  relationship labels, self relationships, `direction`.
- Entities are identified by name (one name space, quoted when not a plain
  identifier); cardinality is stored per end as a semantic value, not glyphs.
- mermaid 12 requires the `: label` part, so a label-less relationship is
  emitted as `: ""` and read back as no label.
- Auto layout via dagre; crow's-foot / bar / ring end glyphs are drawn by the
  renderer from the edge's first and last segment.
- Left out (tolerated on import, dropped with a warning): `classDef` /
  `class` / `style` / `click` / `:::`. Not parsed: the spelled-out
  cardinalities (`one or more`, `only one`, `1+`, …) and attribute types
  containing spaces or commas (`decimal(10,2)`).
### Architecture (done)
- Groups (nested through `in`), services with `(icon)` and `[title]`,
  junctions, and edges `a:R -- L:b` with a port side (T/B/L/R) at each end,
  `<` / `>` arrowheads, `-[title]-` edge titles and the `{group}` modifier
  (the edge ends on the border of the node's group).
- Port sides are IR data (`fromSide` / `toSide`); coordinates are not. The
  layout is mermaid's own idea: a grid in which an edge's sides say which
  neighbouring cell the target takes (`R`/`L` one cell right, `R`/`T` one
  right and one down). Each group is laid out as a grid of its own and enters
  its parent as one cell, so edges between groups constrain the groups.
  Columns and rows line up on the point an edge meets, so a node in a group
  and one outside it are level when joined. Conflicting constraints (two
  edges asking for the same cell) fall back to the nearest free cell, so a
  side is honoured wherever the grid has room, not always.
- What mermaid refuses, the reducer refuses too: one name space for groups,
  services and junctions, a parent group declared first (codegen orders
  groups parent-first whatever the stored order), no edge to a group id
  (mermaid's own db crashes on it; use `member{group}`), no self edge, and
  `{group}` only where the two ends sit in different groups (the reducer and
  the parser drop a flag that would not cross a border).
- The round trip is checked against mermaid's own architecture db (groups,
  nodes, parents, icons, each end's side / arrow / group flag), not only its
  parser.
- Left out (tolerated on import, dropped with a warning): `title`,
  `accTitle` / `accDescr`, and `align row|column ...` layout hints. Icons from
  an icon pack (`logos:aws`) are carried but drawn as a plain tile, since the
  editor has no pack loaded.

## Phase 4 — polish (done)
- README coverage table; the MCP tool description is generated from
  `DIAGRAM_KINDS` so a new kind no longer needs a prose edit.
- `expectCode` in `e2e/helpers.ts`: the CodeMirror wrapper defers external
  value updates for 200ms after a local edit, so a single read of the pane
  right after an edit races the sync. Poll instead of reading once.

## Phase 5 — State diagrams as XState v5 machines (done)
- Second text projection of `StateIR` (ADR 0002), `packages/xstate`:
  `parseXStateMachine` / `stateToXState`, plus the optional `xstate`
  extension on the IR for what mermaid cannot spell.
- Code pane tabs (Mermaid / XState) on the State tab; either text commits to
  the one IR, and the two commit paths re-attach the other projection's
  detail instead of deleting it.
- Generated configs are checked against the real `createMachine`, and the
  mermaid text an XState machine becomes is checked against mermaid.js.
- Left out: composite guards (`and`/`or`/`not`/`stateIn` are function calls,
  and the config is never executed), `params` given as a function, a parallel
  machine root and root-level transitions (mermaid has nowhere to draw them).

## Not planned
- Styling and interaction syntax (`classDef`, `style`, `:::`, `click`,
  `linkStyle`, `%%` comments) stays tolerated-and-dropped: it has no
  meaning in a structural editor, so it cannot survive a round trip.
- Nothing here about container layout any more: flowchart subgraphs, state
  composites, class namespaces and usecase system boundaries are each laid
  out in a graph of their own, so none of them is a dagre cluster and none
  pays the border-rank tax.
- Diagram kinds mermaid supports that gMermaid does not draw yet: pie,
  quadrant, git graph, block, C4, sankey, xychart, radar, packet, kanban
  and treemap. Each would be another vertical slice; the
  registry in `packages/mermaid-parser/src/registry.ts` plus
  `packages/app/src/diagrams.tsx` is where one gets plugged in.
