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
**tolerated and dropped on import** — it has no GUI meaning here.

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
- Per-subgraph `direction` round-trips but layout still has one rankdir.
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
- Per-block `direction` round-trips but is not honored by layout: dagre has
  one rankdir per graph. An empty region is not expressible in mermaid text,
  so the GUI splits an existing member into a new region instead.
### Class (done)
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
- Left out (tolerated on import, dropped): `json` tables (the whole block is
  skipped), icon actors, explicit edge ids and their `animation` / `animate`
  metadata, extra-dash edge length, `classDef` / `class` / `style` / `:::`.

## Phase 4 — polish (done)
- README coverage table; the MCP tool description is generated from
  `DIAGRAM_KINDS` so a new kind no longer needs a prose edit.
- `expectCode` in `e2e/helpers.ts`: the CodeMirror wrapper defers external
  value updates for 200ms after a local edit, so a single read of the pane
  right after an edit races the sync. Poll instead of reading once.

## Not planned
- Styling and interaction syntax (`classDef`, `style`, `:::`, `click`,
  `linkStyle`, `%%` comments) stays tolerated-and-dropped: it has no
  meaning in a structural editor, so it cannot survive a round trip.
- Per-cluster layout direction in flowchart subgraphs and state composites:
  dagre has one rankdir per graph. The text round-trips.
- Diagram kinds mermaid supports that gMermaid does not draw yet: ER, pie,
  quadrant, git graph, block, C4, sankey, xychart, radar, packet, kanban,
  architecture and treemap. Each would be another vertical slice; the
  registry in `packages/mermaid-parser/src/registry.ts` plus
  `packages/app/src/diagrams.tsx` is where one gets plugged in.
