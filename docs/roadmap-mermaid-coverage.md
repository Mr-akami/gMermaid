# Mermaid coverage roadmap (2026-09-21)

**All phases below are merged.** gMermaid supports nine diagram kinds; the
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
- Diagram kinds mermaid supports that gMermaid does not draw yet: ER, pie,
  quadrant, git graph, block, C4, sankey, xychart, radar, packet, kanban,
  architecture and treemap. Each would be another vertical slice; the
  registry in `packages/mermaid-parser/src/registry.ts` plus
  `packages/app/src/diagrams.tsx` is where one gets plugged in.
