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
import { prepareLines, unescapeLabel, type ParseError, type ParseResult } from "./common";

// stateDiagram-v2 subset: simple states, `state "desc" as id`, `id : desc`,
// [*] start/end (scoped per composite block AND per `--` region), composite
// `state X { … }` with concurrency regions and a per-block `direction`,
// <<choice>>/<<fork>>/<<join>>, self-transitions, and notes (inline or block
// form). Dialect the IR cannot hold is DISCARDED by design, same as `%%`
// comments: frontmatter, `%%{init}%%` directives, `style` / `classDef` /
// `class` statements, `hide empty description`, `accTitle` / `accDescr`,
// trailing `;`, and `:::className` suffixes on state ids.

const DROPPED = ["style", "classDef", "class", "hide", "accTitle", "accDescr"];

// letters incl. non-ASCII, digits, `_`, `.` — no `-` (mermaid's state grammar
// rejects it, and it would be ambiguous with `-->`). Mirrors ir's STATE_NAME_RE.
const ID = "[\\p{L}_][\\p{L}\\p{N}_.]*";
const ID_RE = new RegExp(`^${ID}$`, "u");

export function parseStateDiagram(code: string): ParseResult<StateIR> {
  const errors: ParseError[] = [];
  const lines = prepareLines(code, { drop: DROPPED, stripClassSuffix: true });

  const states = new Map<string, StateNode>();
  const order: string[] = [];
  const transitions: StateTransition[] = [];
  const notes: StateNote[] = [];
  let transSeq = 0;
  let noteSeq = 0;
  let headerSeen = false;
  let direction: StateIR["direction"];

  // composite nesting: declarations and [*] resolve against the open block
  // and its current `--` region
  const stack: { id: StateId; openedAt: number; region: number }[] = [];
  const currentParent = (): StateId | undefined => stack[stack.length - 1]?.id;
  const currentRegion = (): number => stack[stack.length - 1]?.region ?? 0;
  const membership = (): Pick<StateNode, "parent" | "region"> => {
    const parent = currentParent();
    const region = currentRegion();
    return { ...(parent !== undefined ? { parent } : {}), ...(region > 0 ? { region } : {}) };
  };

  const declare = (id: string, label?: string, role: StateRole = "normal"): void => {
    const existing = states.get(id);
    if (!existing) {
      order.push(id);
      states.set(id, { id: id as StateId, label: label ?? id, role, ...membership() });
      return;
    }
    // a later explicit label or role decl refines the state in place;
    // membership stays where the state was FIRST mentioned
    if (label !== undefined || role !== "normal") {
      states.set(id, { ...existing, label: label ?? existing.label, ...(role !== "normal" ? { role } : {}) });
    }
  };

  // [*] is start on the left of an arrow, end on the right; one shared
  // pseudo-state per role PER CONTAINER REGION, created on demand.
  const pseudo = (role: "start" | "end"): StateId => {
    const parent = currentParent();
    const region = currentRegion();
    const id =
      parent === undefined ? `state_${role}` : region > 0 ? `state_${role}_${parent}_r${region}` : `state_${role}_${parent}`;
    if (!states.has(id)) {
      order.push(id);
      states.set(id, { id: id as StateId, label: "", role, ...membership() });
    }
    return id as StateId;
  };

  for (let i = 0; i < lines.length; i++) {
    const { text: line, line: lineNo } = lines[i]!;

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
      const d = dir[1] as NonNullable<StateIR["direction"]>;
      const parent = currentParent();
      if (parent === undefined) direction = d;
      else states.set(parent, { ...states.get(parent)!, direction: d });
      continue;
    }

    if (line === "}") {
      if (stack.pop() === undefined) errors.push({ line: lineNo, message: "`}` without an open state block" });
      continue;
    }

    // `--` opens the next concurrency region of the enclosing block
    if (line === "--") {
      const top = stack[stack.length - 1];
      if (top === undefined) errors.push({ line: lineNo, message: "`--` outside a state block" });
      else top.region += 1;
      continue;
    }

    // transition: A --> B [: label], either side may be [*]
    const trans = line.match(new RegExp(`^(\\[\\*\\]|${ID})\\s*-->\\s*(\\[\\*\\]|${ID})\\s*(?::\\s*(.+))?$`, "u"));
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
    const note = line.match(new RegExp(`^[Nn]ote\\s+(left of|right of)\\s+(${ID})\\s*(?::\\s*(.*))?$`, "u"));
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
          const inner = lines[i]!.text;
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
    const special = line.match(new RegExp(`^state\\s+(${ID})\\s+<<(choice|fork|join)>>$`, "u"));
    if (special) {
      declare(special[1]!, undefined, special[2] as StateRole);
      continue;
    }

    // state "description" as id [{]
    const aliased = line.match(new RegExp(`^state\\s+"([^"]*)"\\s+as\\s+(${ID})\\s*(\\{)?$`, "u"));
    if (aliased) {
      declare(aliased[2]!, unescapeLabel(aliased[1]!));
      if (aliased[3] !== undefined) stack.push({ id: aliased[2] as StateId, openedAt: lineNo, region: 0 });
      continue;
    }

    // state id [{]
    const decl = line.match(new RegExp(`^state\\s+(${ID})\\s*(\\{)?$`, "u"));
    if (decl) {
      declare(decl[1]!);
      if (decl[2] !== undefined) stack.push({ id: decl[1] as StateId, openedAt: lineNo, region: 0 });
      continue;
    }

    // id : description
    const desc = line.match(new RegExp(`^(${ID})\\s*:\\s*(.+)$`, "u"));
    if (desc) {
      declare(desc[1]!, unescapeLabel(desc[2]!.trim()));
      continue;
    }

    // bare id
    if (ID_RE.test(line)) {
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
