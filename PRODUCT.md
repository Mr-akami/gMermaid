# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: a developer working with a coding agent (Claude Code, Codex, Cursor, …). The agent writes a design as a Mermaid diagram — architecture, flow, sequence, state machine, plan — and hands it over with `gmermaid open`. The developer reads it, corrects it on the canvas or in the text, adds a note, and sends it back; the agent reads the confirmed source with `gmermaid wait`. The job is checking and fixing a design quickly, not drawing from scratch.

Secondary: anyone editing Mermaid by hand in the standalone editor (`npx @mr-akami/gmermaid`).

## Product Purpose

A GUI editor for Mermaid diagrams, shipped in the same npm package as a CLI and a local MCP server, so an LLM can hand a diagram to a human for review and read back exactly what the human confirmed. Success: the developer catches and fixes what the agent got wrong in the picture, and what goes back to the agent is the diagram they approved — nothing lost, nothing added.

## Positioning

The review loop is the product: agent writes → human sees and edits → agent reads back the confirmed source, over plain files and a CLI. Every supported diagram kind is a full vertical slice (parse → canvas ↔ text in sync → property window → text checked against real mermaid.js). State diagrams are also XState v5 machines, as a second projection of the same model.

## Operating Context

- Runs locally: `npx @mr-akami/gmermaid` opens the editor in the default browser, served from `127.0.0.1` on a random port. Work in progress lives in the browser's local storage.
- Agent workflow: the agent writes `docs/design/<topic>.mmd`, runs `gmermaid validate`, `gmermaid open <file>`, then `gmermaid wait <file>`; the file is shared both ways while open. Installed as a Claude Code plugin or via `npx skills add`.
- Also usable over MCP by LLM clients.

## Capabilities and Constraints

- 13 diagram kinds: flowchart, sequence, class, state (+ XState), requirement, user journey, timeline, gantt, mindmap, ER, quadrant chart, architecture, git graph. See README for per-kind support.
- **One master.** The intermediate model (IR) is the only source of truth; Mermaid text, the canvas and the XState text are projections of it (docs/adr/0001, 0002). Never introduce a second master.
- **Nothing dropped silently.** Syntax or detail that cannot be kept is listed as a warning under the code pane, or refused by name — never quietly deleted.
- **Mermaid.js compatible.** Generated text must be accepted by the real mermaid.js; the editor blocks "Send to agent" when mermaid.js rejects it, and `gmermaid validate` applies the same check.
- **Local only.** Diagrams are never sent to an external service.
- Layout is computed (dagre and per-kind engines); users do not hand-place nodes, except quadrant points, whose coordinates are data.

## Brand Commitments

Name: gMermaid. npm package `@mr-akami/gmermaid`. No other brand assets or voice rules are recorded.

## Evidence on Hand

- README.md: feature table per diagram kind; docs/adr/0001–0003: architecture decisions; CHANGELOG.md: release history.
- No testimonials, user counts, benchmarks or case studies exist; do not invent them.

## Product Principles

1. The human's confirmation is the output: what the agent reads back is exactly what the human approved.
2. Loud over lossy: refuse or warn rather than silently drop anything.
3. One model, many views: every text, canvas and machine view is a projection of the same IR.
4. The picture must read correctly at a glance: labels belong visibly to their edges, frames contain their contents, nothing overlaps.
5. Local and file-based: works with the developer's files and tools, without a service in between.
