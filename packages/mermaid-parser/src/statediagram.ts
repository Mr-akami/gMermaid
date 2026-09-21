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
import { dropList, importedIds, prepareLines, unescapeLabel, type ParseError, type ParseResult, type ParseWarning } from "./common";

// stateDiagram-v2 subset: simple states, `state "desc" as id`, `id : desc`,
// [*] start/end (scoped per composite block AND per `--` region), composite
// `state X { … }` with concurrency regions and a per-block `direction`,
// <<choice>>/<<fork>>/<<join>>, self-transitions, and notes (inline or block
// form). Dialect the IR cannot hold is DISCARDED by design, same as `%%`
// comments: frontmatter, `%%{init}%%` directives, the shared styling
// statements plus `hide empty description` and `title`, trailing `;`, and
// `:::className` suffixes on state ids.

const DROPPED = dropList({ extra: ["hide", "title"] });

// Words mermaid's state grammar claims before it reads an id, verified
// against mermaid.js itself. A hand-typed id from this list is rejected
// rather than rewritten — the id is the user's, and it is theirs to fix.
export const STATE_RESERVED_IDS: readonly string[] = ["class", "classDef", "click", "note", "style"];

// letters incl. non-ASCII, digits, `_`, `.` — no `-` (mermaid's state grammar
// rejects it, and it would be ambiguous with `-->`). Mirrors ir's STATE_NAME_RE.
const ID = "[\\p{L}_][\\p{L}\\p{N}_.]*";
const ID_RE = new RegExp(`^${ID}$`, "u");

export function parseStateDiagram(code: string): ParseResult<StateIR> {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  const lines = prepareLines(code, { drop: DROPPED, stripClassSuffix: true, warnings });
  // State ids are spelled verbatim in the text, so every id that comes in
  // from it passes the import gate.
  const ids = importedIds(STATE_RESERVED_IDS);

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

  const declare = (raw: string, lineNo: number, label?: string, role: StateRole = "normal"): string => {
    const id = ids.take(raw, lineNo);
    const existing = states.get(id);
    if (!existing) {
      order.push(id);
      states.set(id, { id: id as StateId, label: label ?? id, role, ...membership() });
      return id;
    }
    // a later explicit label or role decl refines the state in place;
    // membership stays where the state was FIRST mentioned
    if (label !== undefined || role !== "normal") {
      states.set(id, { ...existing, label: label ?? existing.label, ...(role !== "normal" ? { role } : {}) });
    }
    return id;
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
        return declare(token, lineNo) as StateId;
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
      const target = declare(note[2]!, lineNo);
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
      notes.push({ id: `note-${noteSeq}` as NoteId, target: target as StateId, position, text });
      continue;
    }

    // state id <<choice|fork|join>>
    const special = line.match(new RegExp(`^state\\s+(${ID})\\s+<<(choice|fork|join)>>$`, "u"));
    if (special) {
      declare(special[1]!, lineNo, undefined, special[2] as StateRole);
      continue;
    }

    // state "description" as id [{]
    const aliased = line.match(new RegExp(`^state\\s+"([^"]*)"\\s+as\\s+(${ID})\\s*(\\{)?$`, "u"));
    if (aliased) {
      const id = declare(aliased[2]!, lineNo, unescapeLabel(aliased[1]!));
      if (aliased[3] !== undefined) stack.push({ id: id as StateId, openedAt: lineNo, region: 0 });
      continue;
    }

    // state id [{]
    const decl = line.match(new RegExp(`^state\\s+(${ID})\\s*(\\{)?$`, "u"));
    if (decl) {
      const id = declare(decl[1]!, lineNo);
      if (decl[2] !== undefined) stack.push({ id: id as StateId, openedAt: lineNo, region: 0 });
      continue;
    }

    // id : description
    const desc = line.match(new RegExp(`^(${ID})\\s*:\\s*(.+)$`, "u"));
    if (desc) {
      declare(desc[1]!, lineNo, unescapeLabel(desc[2]!.trim()));
      continue;
    }

    // bare id
    if (ID_RE.test(line)) {
      declare(line, lineNo);
      continue;
    }

    errors.push({ line: lineNo, message: `cannot parse: ${line}` });
  }

  errors.push(...ids.errors());
  if (!headerSeen) errors.push({ line: 1, message: "empty diagram: missing header" });
  for (const open of stack) errors.push({ line: open.openedAt, message: `unclosed state block: ${open.id}` });
  if (errors.length > 0) return { ok: false, errors };
  warnings.push(...ids.warnings());
  warnings.sort((a, b) => a.line - b.line);

  return {
    ok: true,
    warnings,
    ir: {
      kind: "state",
      ...(direction !== undefined ? { direction } : {}),
      states: order.map((id) => states.get(id)!),
      transitions,
      notes,
    },
  };
}
