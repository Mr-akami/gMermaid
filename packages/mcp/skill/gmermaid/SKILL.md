---
name: gmermaid
description: Show a design to the user as a Mermaid diagram they can edit in a GUI (gMermaid), and take their edits and notes back. Use when designing or explaining architecture, flows, sequences, states, classes, requirements or plans and a picture would help the user check it; when the user asks to "draw", "diagram", "visualize" or "show" a design; or when they want to edit a diagram themselves. Also validates Mermaid files.
---

# gMermaid: design with the user through a shared diagram

gMermaid opens a Mermaid file in a browser editor (canvas + code side by side).
The **file is the master copy, both ways**: when you edit the file, the editor
updates; when the user edits in the editor, their change is saved into the
file. When the user is done, they press **Send to agent** (optionally with a
note), and `gmermaid wait` hands that to you.

Run it as `gmermaid` if installed, otherwise `npx -y @mr-akami/gmermaid`.

## The loop

1. **Write the diagram to a file**, e.g. `docs/design/<topic>.mmd`. One diagram
   per file. Pick the kind that fits: `flowchart`, `sequenceDiagram`,
   `classDiagram`, `stateDiagram-v2`, `requirementDiagram`, `journey`,
   `timeline`, `gantt`, `mindmap`, `usecase-beta`.
2. **Validate**: `gmermaid validate docs/design/<topic>.mmd`. Fix every
   `error` line (it names the line). A `warning` means the editor will drop
   that statement when the user edits (styling such as `classDef`/`style`) —
   prefer to leave such statements out.
3. **Show it**: `gmermaid open docs/design/<topic>.mmd --title "<what this is>"`.
   It returns at once. Tell the user in one or two lines what to look at and
   that they can edit it and press **Send to agent** when done.
4. **Wait for the user to send it back**: `gmermaid wait docs/design/<topic>.mmd`.
   - In Claude Code, run it with `run_in_background: true` so the conversation
     stays free; you are notified when it prints.
   - Exit 0: it printed the user's note, whether they edited, and the
     diagram as it now stands. Exit 3: not sent back yet (default timeout
     540s) — run `wait` again. Exit 4: no session (closed); `open` again.
5. **Act on it**: what the user sends back is their review of the design. Read
   their note and compare the diagram with what you proposed — changed
   nodes, edges and labels are decisions the user made. Fix or reconsider the
   design accordingly (code, plan, docs), then update the file to match; the
   editor shows your change immediately. Validate again, say briefly what you
   changed, and go back to step 4.
6. **Finish**: `gmermaid close docs/design/<topic>.mmd` when the design is
   settled. If the diagram belongs in a Markdown doc, copy the final file
   content into a ```mermaid block there.

The user may also ask for diagram changes in chat while the editor is open:
just edit the file — do not reopen it. `gmermaid status` lists open files.

## Notes

- Read the file again before editing it: the user may have changed it in the
  editor since you last looked.
- Nodes the user adds in the GUI get generated ids (`nod_1a2b…`). Keep them, or
  rename consistently in every edge that uses them.
- `gmermaid validate` also checks every ```mermaid block in a `.md` file and
  reads stdin with `-`; use it whenever you write Mermaid anywhere.
