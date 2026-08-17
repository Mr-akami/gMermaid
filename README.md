# gMermaid

A GUI editor for Mermaid flowcharts, sequence diagrams, class diagrams, and
state diagrams. The same distribution also runs a local MCP server, so an LLM
can hand a diagram to a human for review and read back the confirmed source.

Everything ships as one npm package: [`gmermaid`](https://www.npmjs.com/package/gmermaid).

## Edit a diagram yourself

```sh
npx gmermaid
```

Opens the editor in your default browser, served from `127.0.0.1` on a random
port. The canvas and the Mermaid text stay in sync; work in progress is kept in
the browser's local storage.

## Use from an LLM

Install the local STDIO server in Codex, ChatGPT desktop, or another MCP client:

```sh
codex mcp add gmermaid -- npx -y gmermaid mcp
```

For clients configured with JSON, use:

```json
{
  "mcpServers": {
    "gmermaid": {
      "command": "npx",
      "args": ["-y", "gmermaid", "mcp"]
    }
  }
}
```

The LLM calls `review_mermaid` with Mermaid source. MCP Apps-capable clients show the editor inline; other local clients open it in the default browser. After the user selects **LLMへ返す**, the LLM receives the canonical source through `get_mermaid_review`.

ChatGPT web does not read local MCP configuration; use ChatGPT desktop or another local MCP client for the `npx` distribution.

`@gmermaid/mcp` was the pre-consolidation name and is no longer updated; use
`gmermaid` instead.

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm --filter gmermaid build
```

The published CLI lives in `packages/mcp`; the editor UI it bundles comes from
`packages/app`, shared with the MCP review surface.

## Releases

Releases of `gmermaid` use calendar versions such as `2026.817.0`. tagpr
keeps a release pull request up to date on `main`. Merging that pull request
creates the tag and GitHub Release, runs the full verification suite, and
publishes the package to npm through trusted publishing.

The version format is `YYYY.MMDD.MICRO`; `MICRO` increments when more than one
release is made on the same day.

For release setup and first-publish instructions, see
[`docs/releasing.md`](docs/releasing.md).

## License

MIT
