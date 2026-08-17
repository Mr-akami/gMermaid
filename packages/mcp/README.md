# @gmermaid/mcp

Local MCP server that lets an LLM open gMermaid, wait for human review, and receive the confirmed Mermaid source.

```sh
codex mcp add gmermaid -- npx -y @gmermaid/mcp
```

Use `npx -y @gmermaid/mcp` as the STDIO command in other MCP clients. MCP Apps-capable clients render the editor in the conversation. Other clients open a loopback-only browser editor and retrieve the result through `get_mermaid_review`.

Requires Node.js 20 or later. The process binds the browser fallback to `127.0.0.1` on a random port. Diagram contents and review sessions remain in memory and expire after 30 minutes.
