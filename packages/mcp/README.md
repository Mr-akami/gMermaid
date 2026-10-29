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

## Use it from a coding agent (CLI + Skill)

For agents with a shell — Claude Code, Codex and the like — install the
skill once. In Claude Code, as a plugin (it updates with the repository):

```text
/plugin install gmermaid --marketplace Mr-akami/gMermaid
```

For Codex, Cursor and other agents, with the [skills](https://skills.sh) CLI:

```sh
npx skills add Mr-akami/gMermaid
```

Or copy the skill bundled in this package (re-run after upgrading):

```sh
npx -y @mr-akami/gmermaid install-skill            # ~/.claude/skills/gmermaid
npx -y @mr-akami/gmermaid install-skill --project  # ./.claude/skills/gmermaid
```

The skill teaches the agent this loop, built on a **shared file**:

```sh
gmermaid validate docs/design/auth.mmd   # agent wrote a diagram; check it
gmermaid open docs/design/auth.mmd       # show it to the user; returns at once
gmermaid wait docs/design/auth.mmd       # blocks until the user sends it back
gmermaid close docs/design/auth.mmd      # design settled
```

While the editor is open the file is the master copy both ways: the agent edits
the file and the editor follows; the user edits on the canvas or in the code
pane and every change is saved into the file. When the user presses
**Send to agent** (with an optional note such as "add an error branch after
Verify"), `wait` prints the note and the diagram, and the agent fixes or
reconsiders the design, updates the file, and waits again — as many rounds as it
takes. `wait` exits 3 when the user has not sent it back yet (run it again) and
4 when no session is open.

## Use it from an LLM (MCP)

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
Once the user selects **Send to agent**, the LLM receives the canonical source
through `get_mermaid_review`.

ChatGPT web does not read local MCP configuration — use ChatGPT desktop or
another local MCP client for the `npx` distribution.

## Commands

| Command             | What it does                        |
| ------------------- | ----------------------------------- |
| `gmermaid`          | Open the local editor in a browser  |
| `gmermaid editor`   | Same as above, stated explicitly    |
| `gmermaid validate <file\|->…` | Check `.mmd` files or the mermaid blocks of a `.md`; exit 1 on errors |
| `gmermaid open <file> [--title T] [--no-browser]` | Share a file with the user in the editor; returns at once |
| `gmermaid wait <file> [--timeout SEC] [--json]` | Wait for the user to send the file back |
| `gmermaid close <file>` / `gmermaid status` | Stop sharing a file / list shared files |
| `gmermaid install-skill [--project \| --dir PATH]` | Install the agent skill |
| `gmermaid mcp`      | Run the MCP STDIO server            |
| `gmermaid --help`   | Show usage                          |
| `gmermaid --version`| Show the version                    |

## Requirements and scope

Requires Node.js 20 or later. Every mode binds only to `127.0.0.1` on a random
port. MCP review sessions stay in memory and expire after 30 minutes. A file
shared with `gmermaid open` is served by a background process, guarded by a
per-session token kept under `$XDG_STATE_HOME/gmermaid` (owner-only); it stops
on `gmermaid close`, or after two hours with no editor open and no `wait`.

## License

MIT
