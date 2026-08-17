import { newId, type StateId, type TransitionId } from "./ids";
import type { StateDirection, StateIR, StateNode, StateTransition } from "./statediagram";
import { omitUndefined } from "./omitUndefined";

/** State ids appear verbatim in mermaid text, which rejects hyphens —
 * generated ids use underscores instead of newId's `kind-hash` form. */
export function newStateId(): StateId {
  return newId("state").replaceAll("-", "_") as string as StateId;
}

// Same contract as the other diagram actions: intent-carrying, immutable,
// identity-preserving on no-ops.

/** State ids are the exchange identity in mermaid text — keep them id-safe. */
export const STATE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type StateAction =
  | { type: "addState"; state: StateNode }
  | { type: "removeState"; id: StateId }
  | { type: "updateState"; id: StateId; label?: string }
  | { type: "setDirection"; direction: StateDirection }
  | { type: "addTransition"; transition: StateTransition }
  | { type: "updateTransition"; id: TransitionId; label?: string }
  | { type: "removeTransition"; id: TransitionId };

const norm = (v: string | undefined) => (v === "" ? undefined : v);

export function applyStateAction(ir: StateIR, action: StateAction): StateIR {
  switch (action.type) {
    case "addState": {
      const s = action.state;
      if (ir.states.some((x) => x.id === s.id)) return ir;
      if (!STATE_NAME_RE.test(s.id)) return ir;
      // one shared start and one shared end pseudo-state per diagram
      if (s.role !== "normal" && ir.states.some((x) => x.role === s.role)) return ir;
      return { ...ir, states: [...ir.states, s] };
    }

    case "removeState": {
      if (!ir.states.some((s) => s.id === action.id)) return ir;
      return {
        ...ir,
        states: ir.states.filter((s) => s.id !== action.id),
        transitions: ir.transitions.filter((t) => t.from !== action.id && t.to !== action.id),
      };
    }

    case "updateState": {
      const s = ir.states.find((x) => x.id === action.id);
      if (!s || s.role !== "normal") return ir; // [*] has no label
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
  }
}
