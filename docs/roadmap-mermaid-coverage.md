# Mermaid coverage roadmap (2026-09-21)

Goal: close the gap between gMermaid and mermaid.js syntax for the four core
diagrams, then add Gantt / Requirement / Usecase / User Journey.
Each phase = one or more PRs; every PR carries unit tests (parser round
trip, reducer, layout golden) and Playwright GUI tests under `e2e/`.

Design rules stay as in `CONTEXT.md` / ADR 0001: IR is master, layout is
auto, styling/interaction syntax (`style`, `classDef`, `click`, `%%`) is
**tolerated and dropped on import** — it has no GUI meaning here.

## Phase 0 — test infra (done)
- Playwright harness, tab smoke test, CI step. `pnpm test:e2e`.
- Diagram-kind registry (`DIAGRAM_KINDS`, `detectDiagramKind`, `DIAGRAMS`).

## Phase 1 — parser leniency, all kinds (in progress)
- Frontmatter, `%%{init}%%`, trailing `%%` comments, `;` separators, bare
  `flowchart`/`graph TD;` headers, `:::class` stripped, styling/interaction
  lines dropped, `accTitle`/`accDescr` skipped, unicode / dotted ids.

## Phase 2 — core four, feature depth (parallel, one PR per kind)
### Flowchart
- Edge model: line style (solid/dotted/thick/invisible) × head at each end
  (none/arrow/circle/cross) → `<-->`, `--o`, `x--x`, `-.-`, `===`.
- Edge length (`--->` = dagre minlen).
- `A@{ shape: … }` parse/emit for existing shapes + new shapes
  (doc, notch-rect, text, hourglass, delay, fork, bolt, tri, flip-tri,
  sl-rect, lin-cyl, f-circ …).
- Id-less `subgraph Title`, subgraph `direction` editor.
- Guard `A--txt-->B` mis-parse.
### Sequence
- Activation (`+`/`-` suffix and `activate`/`deactivate`), `box`, `rect`,
  `create`/`destroy`, participant types `@{ type: … }`, multi-line notes
  (tspan + textarea), `autonumber start step` fields, `title`.
### State
- Concurrency `--` regions, per-block `direction`, multi-line notes,
  self-transitions, `state X <<choice>>` etc. already ok.
### Class
- Reversed / two-way relation tokens, `direction TD`, `classDiagram-v2`,
  `class X["label"]` + relaxed names, `*`/`$` classifiers, type-first
  attributes, inline `<<annotation>>`, generic class names, notes,
  namespaces, lollipop.

## Phase 3 — new diagram kinds (parallel, one PR per kind)
Wave 1: Gantt, Requirement, User Journey.
Wave 2: Mindmap, Timeline, Usecase (`usecase-beta`, needs mermaid ≥ 12 for
validation — dev dependency bumped to 12.0.0; existing integration tests
still pass).
Each: IR + actions, parser, codegen, layout, renderer, editor + property
window, registry entry, mermaid.js integration test, e2e spec.

## Phase 4 — polish
- Cross-kind: shared `<br/>` multi-line text rendering, README/coverage
  table, homework cleanup.
