# gmermaid

A local GUI editor for Mermaid diagrams — flowcharts, sequence diagrams, class
diagrams, and state diagrams. The same binary also runs an MCP server, so an
LLM can hand a diagram to a human, wait for the edit, and read back the result.

## Edit a diagram yourself

```sh
npx @mr-akami/gmermaid
```

This starts a loopback-only server on a random port and opens the editor in
your default browser. Diagrams are edited on a canvas and as Mermaid text side
by side; work in progress is saved in the browser's local storage.

## Use it from an LLM

```sh
codex mcp add gmermaid -- npx -y @mr-akami/gmermaid mcp
```

For clients configured with JSON:

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

The LLM calls `review_mermaid` with Mermaid source. MCP Apps-capable clients
render the editor inline; other local clients open it in the default browser.
Once the user selects **LLMへ返す**, the LLM receives the canonical source
through `get_mermaid_review`.

ChatGPT web does not read local MCP configuration — use ChatGPT desktop or
another local MCP client for the `npx` distribution.

## Commands

| Command             | What it does                        |
| ------------------- | ----------------------------------- |
| `gmermaid`          | Open the local editor in a browser  |
| `gmermaid editor`   | Same as above, stated explicitly    |
| `gmermaid mcp`      | Run the MCP STDIO server            |
| `gmermaid --help`   | Show usage                          |
| `gmermaid --version`| Show the version                    |

## Requirements and scope

Requires Node.js 20 or later. Both modes bind only to `127.0.0.1` on a random
port. Diagram contents and review sessions stay in memory and expire after 30
minutes.

## License

MIT
