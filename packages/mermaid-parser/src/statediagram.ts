import type {
  NoteId,
  StateIR,
  StateId,
  StateNode,
  StateNote,
  StateRole,
  StateTransition,
  TransitionId,
} from "@gmermaid/ir";
import { unescapeLabel, type ParseError, type ParseResult } from "./common";

// stateDiagram-v2 subset: simple states, `state "desc" as id`, `id : desc`,
// [*] start/end (scoped per composite block), composite `state X { … }`,
// <<choice>>/<<fork>>/<<join>>, and notes. Concurrency (`--` regions) and
// classDef styling are not recognized. `%%` comments are skipped (mermaid's
// own parser discards them too).

const ID = "[A-Za-z_][A-Za-z0-9_]*";

export function parseStateDiagram(code: string): ParseResult<StateIR> {
  const errors: ParseError[] = [];
  const lines = code.split("\n");

  const states = new Map<string, StateNode>();
  const order: string[] = [];
  const transitions: StateTransition[] = [];
  const notes: StateNote[] = [];
  let transSeq = 0;
  let noteSeq = 0;
  let headerSeen = false;
  let direction: StateIR["direction"];

  // composite nesting: declarations and [*] resolve against the open block
  const stack: { id: StateId; openedAt: number }[] = [];
  const currentParent = (): StateId | undefined => stack[stack.length - 1]?.id;

  const declare = (id: string, label?: string, role: StateRole = "normal"): void => {
    const existing = states.get(id);
    if (!existing) {
      order.push(id);
      const parent = currentParent();
      states.set(id, {
        id: id as StateId,
        label: label ?? id,
        role,
        ...(parent !== undefined ? { parent } : {}),
      });
      return;
    }
    // a later explicit label or role decl refines the state in place;
    // membership stays where the state was FIRST mentioned
    if (label !== undefined || role !== "normal") {
      states.set(id, { ...existing, label: label ?? existing.label, ...(role !== "normal" ? { role } : {}) });
    }
  };

  // [*] is start on the left of an arrow, end on the right; one shared
  // pseudo-state per role PER CONTAINER, created on demand.
  const pseudo = (role: "start" | "end"): StateId => {
    const parent = currentParent();
    const id = parent !== undefined ? `state_${role}_${parent}` : `state_${role}`;
    if (!states.has(id)) {
      order.push(id);
      states.set(id, { id: id as StateId, label: "", role, ...(parent !== undefined ? { parent } : {}) });
    }
    return id as StateId;
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i]!.trim();
    if (line === "" || line.startsWith("%%")) continue;

    if (!headerSeen) {
      if (line !== "stateDiagram-v2" && line !== "stateDiagram") {
        errors.push({ line: lineNo, message: "expected `stateDiagram-v2` header" });
        return { ok: false, errors };
      }
      headerSeen = true;
      continue;
    }

    const dir = line.match(/^direction\s+(TB|LR|BT|RL)$/);
    if (dir) {
      if (stack.length === 0) direction = dir[1] as NonNullable<StateIR["direction"]>;
      // direction inside a composite: accepted, but the layout engine cannot
      // honor per-block direction — silently dropped
      continue;
    }

    if (line === "}") {
      if (stack.pop() === undefined) errors.push({ line: lineNo, message: "`}` without an open state block" });
      continue;
    }

    // transition: A --> B [: label], either side may be [*]
    const trans = line.match(new RegExp(`^(\\[\\*\\]|${ID})\\s*-->\\s*(\\[\\*\\]|${ID})\\s*(?::\\s*(.+))?$`));
    if (trans) {
      const resolve = (token: string, role: "start" | "end"): StateId => {
        if (token === "[*]") return pseudo(role);
        declare(token);
        return token as StateId;
      };
      const from = resolve(trans[1]!, "start");
      const to = resolve(trans[2]!, "end");
      transSeq += 1;
      transitions.push({
        id: `transition-${transSeq}` as TransitionId,
        from,
        to,
        ...(trans[3] !== undefined ? { label: unescapeLabel(trans[3].trim()) } : {}),
      });
      continue;
    }

    // note left of X : text   /   note right of X (block form) … end note
    const note = line.match(new RegExp(`^[Nn]ote\\s+(left of|right of)\\s+(${ID})\\s*(?::\\s*(.*))?$`));
    if (note) {
      const position = note[1] === "left of" ? "leftOf" : "rightOf";
      declare(note[2]!);
      let text: string;
      if (note[3] !== undefined) {
        text = unescapeLabel(note[3].trim());
      } else {
        // block form: collect lines until `end note`
        const body: string[] = [];
        let closed = false;
        while (i + 1 < lines.length) {
          i += 1;
          const inner = lines[i]!.trim();
          if (inner === "end note") {
            closed = true;
            break;
          }
          body.push(inner);
        }
        if (!closed) {
          errors.push({ line: lineNo, message: "unterminated `note` block (missing `end note`)" });
          continue;
        }
        text = unescapeLabel(body.join("\n"));
      }
      noteSeq += 1;
      notes.push({ id: `note-${noteSeq}` as NoteId, target: note[2] as StateId, position, text });
      continue;
    }

    // state id <<choice|fork|join>>
    const special = line.match(new RegExp(`^state\\s+(${ID})\\s+<<(choice|fork|join)>>$`));
    if (special) {
      declare(special[1]!, undefined, special[2] as StateRole);
      continue;
    }

    // state "description" as id [{]
    const aliased = line.match(new RegExp(`^state\\s+"([^"]*)"\\s+as\\s+(${ID})\\s*(\\{)?$`));
    if (aliased) {
      declare(aliased[2]!, unescapeLabel(aliased[1]!));
      if (aliased[3] !== undefined) stack.push({ id: aliased[2] as StateId, openedAt: lineNo });
      continue;
    }

    // state id [{]
    const decl = line.match(new RegExp(`^state\\s+(${ID})\\s*(\\{)?$`));
    if (decl) {
      declare(decl[1]!);
      if (decl[2] !== undefined) stack.push({ id: decl[1] as StateId, openedAt: lineNo });
      continue;
    }

    // id : description
    const desc = line.match(new RegExp(`^(${ID})\\s*:\\s*(.+)$`));
    if (desc) {
      declare(desc[1]!, unescapeLabel(desc[2]!.trim()));
      continue;
    }

    // bare id
    if (new RegExp(`^${ID}$`).test(line)) {
      declare(line);
      continue;
    }

    errors.push({ line: lineNo, message: `cannot parse: ${line}` });
  }

  if (!headerSeen) errors.push({ line: 1, message: "empty diagram: missing header" });
  for (const open of stack) errors.push({ line: open.openedAt, message: `unclosed state block: ${open.id}` });
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    ir: {
      kind: "state",
      ...(direction !== undefined ? { direction } : {}),
      states: order.map((id) => states.get(id)!),
      transitions,
      notes,
    },
  };
}
