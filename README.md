# gMermaid

A GUI editor for Mermaid flowcharts, sequence diagrams, and class diagrams. The repository also contains a local MCP server for human-in-the-loop diagram review.

## Use from an LLM

Install the local STDIO server in Codex, ChatGPT desktop, or another MCP client:

```sh
codex mcp add gmermaid -- npx -y @gmermaid/mcp
```

For clients configured with JSON, use:

```json
{
  "mcpServers": {
    "gmermaid": {
      "command": "npx",
      "args": ["-y", "@gmermaid/mcp"]
    }
  }
}
```

The LLM calls `review_mermaid` with Mermaid source. MCP Apps-capable clients show the editor inline; other local clients open it in the default browser. After the user selects **LLMへ返す**, the LLM receives the canonical source through `get_mermaid_review`.

ChatGPT web does not read local MCP configuration; use ChatGPT desktop or another local MCP client for the `npx` distribution.

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm --filter @gmermaid/mcp build
```

## Releases

Releases of `@gmermaid/mcp` use calendar versions such as `2026.817.0`. tagpr
keeps a release pull request up to date on `main`. Merging that pull request
creates the tag and GitHub Release, runs the full verification suite, and
publishes the package to npm through trusted publishing.

The version format is `YYYY.MMDD.MICRO`; `MICRO` increments when more than one
release is made on the same day.

For release setup and first-publish instructions, see
[`docs/releasing.md`](docs/releasing.md).

## License

MIT
