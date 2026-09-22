# Changelog

## [v2026.922.0](https://github.com/Mr-akami/gMermaid/compare/v2026.818.0...v2026.922.0) - 2026-09-22

### Other changes
- test: add Playwright e2e harness with tab smoke tests by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/10
- refactor: single diagram-kind registry for parser, app tabs, and mcp by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/12
- feat(parser): tolerate mermaid dialect (frontmatter, ;, styling, unicode ids) by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/13
- chore: bump mermaid dev dep to 12 (usecase-beta validation); roadmap wave 2 by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/14
- feat(requirement): add requirementDiagram end-to-end by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/15
- feat(journey): user journey diagrams end to end by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/16
- test: poll the code pane in e2e, add its resync regression test by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/17
- feat(state): concurrency regions, per-block direction, block notes, self-transitions by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/18
- feat(timeline): timeline diagrams end to end by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/19
- feat(sequence): activation, boxes, rect, create/destroy, participant types by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/20
- feat(flowchart): edge line/head model, length, @{ shape } syntax, id-less subgraphs by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/21
- feat(class): relation heads, labels, classifiers, annotations, notes, namespaces by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/22
- feat(gantt): gantt charts end to end by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/23
- feat(mindmap): mindmap diagrams end to end by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/24
- docs: diagram coverage table; MCP tool lists kinds from the registry by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/25
- feat(usecase): usecase-beta diagrams end to end by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/26
- docs: mark the mermaid coverage roadmap complete by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/27
- fix(flowchart): edge heads the mermaid text can actually spell by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/28
- fix(parser): one drop policy for every kind, and say what was dropped by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/29
- fix(parser): warn when a :::class suffix is stripped by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/30
- fix(ir): close the IR states the mermaid text cannot spell by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/31
- fix(codegen): carry `%%` in unquoted text as an entity by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/32
- fix(state): build composites from the GUI, and scope [*] per container by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/34
- fix(ir): mint ids no mermaid keyword can swallow by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/35
- fix(sequence): let a note say which lifeline it is on by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/36
- fix(layout): reserve space for edge labels by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/37
- feat(app): validate the code pane with the real mermaid parser by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/33
- fix(renderer): draw edges as mermaid does, and clear the container titles by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/38
- fix(layout): place the labels dagre never sees by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/39
- fix(layout): lay out each state composite on its own dagre graph by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/41
- feat(state): edit the diagram as an XState v5 machine by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/40
- fix(layout): lay out each flowchart subgraph on its own by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/42
- fix(app): make the ten editors behave like one product by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/43
- feat: name and edit every connector's endpoints by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/44
- feat(app): select a range, act on it, copy it out as mermaid by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/46
- feat(clipboard): copy and paste a selection as mermaid text by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/45
- fix(layout): keep notes and connectors off everything else drawn by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/47
- feat/clipboard integration by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/48

## [v2026.818.0](https://github.com/Mr-akami/gMermaid/compare/v2026.817.0...v2026.818.0) - 2026-08-18

### Other changes
- ci: skip publish when the version is already on npm by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/8

## [v2026.818.0](https://github.com/Mr-akami/gMermaid/commits/v2026.818.0) - 2026-08-18

### Other changes
- feat: expand mermaid syntax coverage, add stateDiagram, fix note/life… by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/1
- feat/mermaid syntax coverage by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/2
- feat: composit state gui by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/4
- Release for v2026.817.0 by @github-actions[bot] in https://github.com/Mr-akami/gMermaid/pull/3
- feat: unify distribution into single gmermaid package (editor + mcp modes) by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/6
- chore: publish as @mr-akami/gmermaid, single gmermaid bin by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/7

## [v2026.817.0](https://github.com/Mr-akami/gMermaid/commits/v2026.817.0) - 2026-08-17

### Other changes
- feat: expand mermaid syntax coverage, add stateDiagram, fix note/life… by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/1
- feat/mermaid syntax coverage by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/2
- feat: composit state gui by @Mr-akami in https://github.com/Mr-akami/gMermaid/pull/4
