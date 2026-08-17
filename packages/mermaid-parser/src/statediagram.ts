import type { StateIR, StateId, StateNode, StateTransition, TransitionId } from "@gmermaid/ir";
import { unescapeLabel, type ParseError, type ParseResult } from "./common";

// Flat stateDiagram-v2 subset: simple states, `state "desc" as id`,
// `id : desc`, [*] start/end and labeled transitions. Composite states,
// <<choice>>/<<fork>>/<<join>> and concurrency are not recognized (yet).

const ID = "[A-Za-z_][A-Za-z0-9_]*";

export function parseStateDiagram(code: string): ParseResult<StateIR> {
  const errors: ParseError[] = [];
  const lines = code.split("\n");

  const states = new Map<string, StateNode>();
  const order: string[] = [];
  const transitions: StateTransition[] = [];
  let transSeq = 0;
  let headerSeen = false;
  let direction: StateIR["direction"];

  const declare = (id: string, label?: string): void => {
    const existing = states.get(id);
    if (!existing) {
      order.push(id);
      states.set(id, { id: id as StateId, label: label ?? id, role: "normal" });
    } else if (label !== undefined) {
      states.set(id, { ...existing, label });
    }
  };

  // [*] is start on the left of an arrow, end on the right; one shared
  // pseudo-state each, created on demand with a reserved id.
  const pseudo = (role: "start" | "end"): StateId => {
    const id = `state_${role}`;
    if (!states.has(id)) {
      order.push(id);
      states.set(id, { id: id as StateId, label: "", role });
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
      direction = dir[1] as NonNullable<StateIR["direction"]>;
      continue;
    }

    // transition: A --> B [: label], either side may be [*]
    const trans = line.match(new RegExp(`^(\\[\\*\\]|${ID})\\s*-->\\s*(\\[\\*\\]|${ID})\\s*(?::\\s*(.+))?$`));
    if (trans) {
      const from = trans[1] === "[*]" ? pseudo("start") : ((): StateId => {
        declare(trans[1]!);
        return trans[1] as StateId;
      })();
      const to = trans[2] === "[*]" ? pseudo("end") : ((): StateId => {
        declare(trans[2]!);
        return trans[2] as StateId;
      })();
      transSeq += 1;
      transitions.push({
        id: `transition-${transSeq}` as TransitionId,
        from,
        to,
        ...(trans[3] !== undefined ? { label: unescapeLabel(trans[3].trim()) } : {}),
      });
      continue;
    }

    // state "description" as id
    const aliased = line.match(new RegExp(`^state\\s+"([^"]*)"\\s+as\\s+(${ID})$`));
    if (aliased) {
      declare(aliased[2]!, unescapeLabel(aliased[1]!));
      continue;
    }

    // state id
    const decl = line.match(new RegExp(`^state\\s+(${ID})$`));
    if (decl) {
      declare(decl[1]!);
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
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    ir: {
      kind: "state",
      ...(direction !== undefined ? { direction } : {}),
      states: order.map((id) => states.get(id)!),
      transitions,
    },
  };
}
