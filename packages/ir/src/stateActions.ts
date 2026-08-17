import { newId, type NoteId, type StateId, type TransitionId } from "./ids";
import type { StateDirection, StateIR, StateNode, StateNotePosition, StateTransition } from "./statediagram";
import { omitUndefined } from "./omitUndefined";

// Same contract as the other diagram actions: intent-carrying, immutable,
// identity-preserving on no-ops.

/** State ids are the exchange identity in mermaid text — keep them id-safe. */
export const STATE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** State ids appear verbatim in mermaid text, which rejects hyphens —
 * generated ids use underscores instead of newId's `kind-hash` form. */
export function newStateId(): StateId {
  return newId("state").replaceAll("-", "_") as string as StateId;
}

export type StateAction =
  | { type: "addState"; state: StateNode }
  | { type: "removeState"; id: StateId }
  | { type: "updateState"; id: StateId; label?: string }
  | { type: "setDirection"; direction: StateDirection }
  | { type: "addTransition"; transition: StateTransition }
  | { type: "updateTransition"; id: TransitionId; label?: string }
  | { type: "removeTransition"; id: TransitionId }
  | { type: "addStateNote"; note: { id: NoteId; target: StateId; position: StateNotePosition; text: string } }
  | { type: "updateStateNote"; id: NoteId; text?: string; position?: StateNotePosition }
  | { type: "removeStateNote"; id: NoteId };

const norm = (v: string | undefined) => (v === "" ? undefined : v);

/** The removed state plus every descendant (composite children cascade). */
function withDescendants(ir: StateIR, root: StateId): Set<StateId> {
  const doomed = new Set<StateId>([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of ir.states) {
      if (s.parent !== undefined && doomed.has(s.parent) && !doomed.has(s.id)) {
        doomed.add(s.id);
        grew = true;
      }
    }
  }
  return doomed;
}

export function applyStateAction(ir: StateIR, action: StateAction): StateIR {
  switch (action.type) {
    case "addState": {
      const s = action.state;
      if (ir.states.some((x) => x.id === s.id)) return ir;
      if (!STATE_NAME_RE.test(s.id)) return ir;
      if (s.parent !== undefined && !ir.states.some((x) => x.id === s.parent && x.role === "normal")) return ir;
      // one start and one end pseudo-state per container ([*] is scoped)
      if (
        (s.role === "start" || s.role === "end") &&
        ir.states.some((x) => x.role === s.role && x.parent === s.parent)
      ) {
        return ir;
      }
      return { ...ir, states: [...ir.states, s] };
    }

    case "removeState": {
      if (!ir.states.some((s) => s.id === action.id)) return ir;
      const doomed = withDescendants(ir, action.id);
      return {
        ...ir,
        states: ir.states.filter((s) => !doomed.has(s.id)),
        transitions: ir.transitions.filter((t) => !doomed.has(t.from) && !doomed.has(t.to)),
        notes: ir.notes.filter((n) => !doomed.has(n.target)),
      };
    }

    case "updateState": {
      const s = ir.states.find((x) => x.id === action.id);
      if (!s || s.role !== "normal") return ir; // pseudo-states have no label
      const label = action.label ?? s.label;
      if (label === s.label) return ir;
      return { ...ir, states: ir.states.map((x) => (x.id === action.id ? { ...x, label } : x)) };
    }

    case "setDirection":
      return ir.direction === action.direction ? ir : { ...ir, direction: action.direction };

    case "addTransition": {
      const t = action.transition;
      if (ir.transitions.some((x) => x.id === t.id)) return ir;
      const known = (id: StateId) => ir.states.some((s) => s.id === id);
      if (!known(t.from) || !known(t.to)) return ir;
      // like flowchart edges: no self-transitions (no layout for them yet)
      if (t.from === t.to) return ir;
      return { ...ir, transitions: [...ir.transitions, omitUndefined({ ...t, label: norm(t.label) })] };
    }

    case "updateTransition": {
      const t = ir.transitions.find((x) => x.id === action.id);
      if (!t) return ir;
      const label = action.label !== undefined ? norm(action.label) : t.label;
      if (label === t.label) return ir;
      return {
        ...ir,
        transitions: ir.transitions.map((x) => (x.id === action.id ? omitUndefined({ ...x, label }) : x)),
      };
    }

    case "removeTransition": {
      if (!ir.transitions.some((t) => t.id === action.id)) return ir;
      return { ...ir, transitions: ir.transitions.filter((t) => t.id !== action.id) };
    }

    case "addStateNote": {
      const n = action.note;
      if (ir.notes.some((x) => x.id === n.id)) return ir;
      if (!ir.states.some((s) => s.id === n.target)) return ir;
      return { ...ir, notes: [...ir.notes, n] };
    }

    case "updateStateNote": {
      const n = ir.notes.find((x) => x.id === action.id);
      if (!n) return ir;
      const text = action.text ?? n.text;
      const position = action.position ?? n.position;
      if (text === n.text && position === n.position) return ir;
      return { ...ir, notes: ir.notes.map((x) => (x.id === action.id ? { ...x, text, position } : x)) };
    }

    case "removeStateNote": {
      if (!ir.notes.some((n) => n.id === action.id)) return ir;
      return { ...ir, notes: ir.notes.filter((n) => n.id !== action.id) };
    }
  }
}
