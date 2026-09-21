# gMermaid

A GUI editor for Mermaid diagrams. The same distribution also runs a local MCP
server, so an LLM can hand a diagram to a human for review and read back the
confirmed source.

## Diagrams

Every kind below is a full vertical slice: the Mermaid text parses into the
intermediate model, the canvas and the text stay in sync, a property window
edits the selected element, and the generated text is checked against
mermaid.js itself in the test suite.

| Diagram | Header | Notable support |
| --- | --- | --- |
| Flowchart | `flowchart` / `graph` | 37 node shapes incl. `@{ shape: … }`, line style and both arrow heads, edge length, subgraphs with direction |
| Sequence | `sequenceDiagram` | activations, `box`, `rect`, `create`/`destroy`, 8 participant types, autonumber, notes |
| Class | `classDiagram` | reversed, two-way and lollipop relations, generics, `*`/`$` classifiers, annotations, notes, namespaces |
| State | `stateDiagram-v2` | composites, concurrency regions, choice/fork/join, self-transitions, block notes |
| Requirement | `requirementDiagram` | 6 requirement types, elements, 7 relation types, risk and verify method |
| User journey | `journey` | sections, tasks, scores, actors |
| Timeline | `timeline` | sections, periods, multiple events per period |
| Gantt | `gantt` | date formats, durations, `after`/`until` dependencies, milestones, excludes |
| Mindmap | `mindmap` | indentation hierarchy, 7 node shapes, icons, drag to re-parent |

Styling and interaction syntax (`classDef`, `style`, `:::`, `click`, `%%`
comments) is accepted on import and dropped: it carries no meaning in the
editor, so it does not survive a round trip. Every kind drops the same set,
and each dropped statement is listed under the code pane so nothing goes
missing quietly.

Everything ships as one npm package: [`@mr-akami/gmermaid`](https://www.npmjs.com/package/@mr-akami/gmermaid).

## Edit a diagram yourself

```sh
npx @mr-akami/gmermaid
```

Opens the editor in your default browser, served from `127.0.0.1` on a random
port. The canvas and the Mermaid text stay in sync; work in progress is kept in
the browser's local storage.

## Use from an LLM

Install the local STDIO server in Codex, ChatGPT desktop, or another MCP client:

```sh
codex mcp add gmermaid -- npx -y @mr-akami/gmermaid mcp
```

For clients configured with JSON, use:

```json
{
  "mcpServers": {
    "gmermaid": {
      "command": "npx",
      "args": ["-y", "@mr-akami/gmermaid", "mcp"]
    }
  }
}
```

The LLM calls `review_mermaid` with Mermaid source for any diagram kind above. MCP Apps-capable clients show the editor inline; other local clients open it in the default browser. After the user selects **LLMへ返す**, the LLM receives the canonical source through `get_mermaid_review`.

ChatGPT web does not read local MCP configuration; use ChatGPT desktop or another local MCP client for the `npx` distribution.

`@gmermaid/mcp` was the pre-consolidation name and is no longer updated; use
`@mr-akami/gmermaid` instead.

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm --filter @mr-akami/gmermaid build
```

The published CLI lives in `packages/mcp`; the editor UI it bundles comes from
`packages/app`, shared with the MCP review surface.

## Releases

Releases of `@mr-akami/gmermaid` use calendar versions such as `2026.817.0`. tagpr
keeps a release pull request up to date on `main`. Merging that pull request
creates the tag and GitHub Release, runs the full verification suite, and
publishes the package to npm through trusted publishing.

The version format is `YYYY.MMDD.MICRO`; `MICRO` increments when more than one
release is made on the same day.

For release setup and first-publish instructions, see
[`docs/releasing.md`](docs/releasing.md).

## License

MIT
