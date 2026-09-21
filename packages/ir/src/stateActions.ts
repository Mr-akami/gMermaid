import { newId, type NoteId, type StateId, type TransitionId } from "./ids";
import type { StateDirection, StateIR, StateNode, StateNotePosition, StateTransition } from "./statediagram";
import { omitUndefined } from "./omitUndefined";

// Same contract as the other diagram actions: intent-carrying, immutable,
// identity-preserving on no-ops.

/** State ids are the exchange identity in mermaid text — keep them id-safe.
 * Letters (any script), digits, `_` and `.`; mirrors the parser's state ID. */
export const STATE_NAME_RE = /^[\p{L}_][\p{L}\p{N}_.]*$/u;

/** State ids appear verbatim in mermaid text, which rejects hyphens —
 * generated ids use underscores instead of newId's `kind-hash` form. */
export function newStateId(): StateId {
  return newId("state").replaceAll("-", "_") as string as StateId;
}

export type StateAction =
  | { type: "addState"; state: StateNode }
  | { type: "removeState"; id: StateId }
  | { type: "updateState"; id: StateId; label?: string }
  // composite membership: null = move to top level; region defaults to 0
  | { type: "setStateParent"; id: StateId; parent: StateId | null; region?: number }
  // concurrency region within the current parent (any index ≥ 0; indices
  // are compacted, so `regionCount` means "a new region")
  | { type: "setStateRegion"; id: StateId; region: number }
  | { type: "setDirection"; direction: StateDirection }
  // per-block direction of a composite: null = inherit
  | { type: "setStateDirection"; id: StateId; direction: StateDirection | null }
  | { type: "addTransition"; transition: StateTransition }
  | { type: "updateTransition"; id: TransitionId; label?: string }
  | { type: "removeTransition"; id: TransitionId }
  | { type: "addStateNote"; note: { id: NoteId; target: StateId; position: StateNotePosition; text: string } }
  | { type: "updateStateNote"; id: NoteId; text?: string; position?: StateNotePosition }
  | { type: "removeStateNote"; id: NoteId };

const norm = (v: string | undefined) => (v === "" ? undefined : v);
const regionOf = (s: { region?: number }): number => s.region ?? 0;
const validRegion = (r: number | undefined): boolean => r === undefined || (Number.isInteger(r) && r >= 0);

/** Why `state` cannot carry a note, or undefined when it can. A note names
 * its target by id (`note right of X`), but a start/end pseudo-state is only
 * ever written as `[*]` and never declared — the note would re-import as a
 * brand-new normal state with that generated id. Shared by the reducer
 * (reject) and the UI (disable + show the reason). */
export function stateNoteRejection(state: StateNode): string | undefined {
  return state.role === "start" || state.role === "end" ? "[*] has no name in the text, so it cannot carry a note" : undefined;
}

/** Why re-parenting `id` under `parent` (region `region`) is not allowed, or
 * undefined when it is. Shared by the reducer (reject) and the UI (disable +
 * show the reason — a silent no-op would read as "the button does nothing"). */
export function reparentRejection(ir: StateIR, id: StateId, parent: StateId | null, region = 0): string | undefined {
  const s = ir.states.find((x) => x.id === id);
  if (!s) return "unknown state";
  if (!validRegion(region)) return "invalid region";
  if (parent === null) return undefined;
  if (parent === id) return "cannot move a state into itself";
  const target = ir.states.find((x) => x.id === parent);
  if (!target) return "unknown target state";
  if (target.role !== "normal") return "only a normal state can contain states";
  // the target must not live inside the moved state (cycle)
  let cur: StateId | undefined = target.parent;
  while (cur !== undefined) {
    if (cur === id) return "cannot move a state into its own child";
    cur = ir.states.find((x) => x.id === cur)?.parent;
  }
  // [*] is scoped: one start and one end per container region
  if (
    (s.role === "start" || s.role === "end") &&
    ir.states.some((x) => x.id !== id && x.role === s.role && x.parent === parent && regionOf(x) === region)
  ) {
    return `the target region already has a ${s.role} [*]`;
  }
  return undefined;
}

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

/** Renumber the regions of `parent`'s children to 0..n-1 in ascending order
 * (0 = field absent). Mermaid has no empty regions, so a gap left by a move
 * or removal would silently collapse on the next round trip — collapsing it
 * here keeps the IR canonical. Identity when nothing changes. */
function compactRegions(states: readonly StateNode[], parent: StateId | undefined): readonly StateNode[] {
  if (parent === undefined) return states;
  const used = [...new Set(states.filter((s) => s.parent === parent).map(regionOf))].toSorted((a, b) => a - b);
  const remap = new Map(used.map((r, i) => [r, i]));
  let changed = false;
  const next = states.map((s) => {
    if (s.parent !== parent) return s;
    const r = remap.get(regionOf(s))!;
    if (r === regionOf(s) && (r !== 0 || s.region === undefined)) return s;
    changed = true;
    return omitUndefined({ ...s, region: r === 0 ? undefined : r });
  });
  return changed ? next : states;
}

export function applyStateAction(ir: StateIR, action: StateAction): StateIR {
  switch (action.type) {
    case "addState": {
      const s = action.state;
      if (ir.states.some((x) => x.id === s.id)) return ir;
      if (!STATE_NAME_RE.test(s.id)) return ir;
      if (s.parent !== undefined && !ir.states.some((x) => x.id === s.parent && x.role === "normal")) return ir;
      // regions only exist inside a composite
      if (!validRegion(s.region) || (s.region !== undefined && s.parent === undefined)) return ir;
      // one start and one end pseudo-state per container region ([*] is scoped)
      if (
        (s.role === "start" || s.role === "end") &&
        ir.states.some((x) => x.role === s.role && x.parent === s.parent && regionOf(x) === regionOf(s))
      ) {
        return ir;
      }
      // only a normal state has a label slot in the text (`state "x" as id`).
      // A `<<choice>>`/`<<fork>>`/`<<join>>` declaration re-reads with its id
      // as the label and `[*]` has no name at all, so store what comes back.
      const state =
        s.role === "normal" ? s : { ...s, label: s.role === "start" || s.role === "end" ? "" : (s.id as string) };
      return { ...ir, states: compactRegions([...ir.states, state], s.parent) };
    }

    case "removeState": {
      const victim = ir.states.find((s) => s.id === action.id);
      if (!victim) return ir;
      const doomed = withDescendants(ir, action.id);
      return {
        ...ir,
        states: compactRegions(
          ir.states.filter((s) => !doomed.has(s.id)),
          victim.parent,
        ),
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

    case "setStateParent": {
      const region = action.region ?? 0;
      if (reparentRejection(ir, action.id, action.parent, region) !== undefined) return ir;
      const parent = action.parent ?? undefined;
      const s = ir.states.find((x) => x.id === action.id)!;
      if (s.parent === parent && regionOf(s) === region) return ir;
      const moved = ir.states.map((x) =>
        x.id === action.id ? omitUndefined({ ...x, parent, region: parent !== undefined && region !== 0 ? region : undefined }) : x,
      );
      return { ...ir, states: compactRegions(compactRegions(moved, s.parent), parent) };
    }

    case "setStateRegion": {
      const s = ir.states.find((x) => x.id === action.id);
      if (!s || s.parent === undefined) return ir;
      if (reparentRejection(ir, action.id, s.parent, action.region) !== undefined) return ir;
      if (regionOf(s) === action.region) return ir;
      const moved = ir.states.map((x) =>
        x.id === action.id ? omitUndefined({ ...x, region: action.region === 0 ? undefined : action.region }) : x,
      );
      return { ...ir, states: compactRegions(moved, s.parent) };
    }

    case "setDirection":
      return ir.direction === action.direction ? ir : { ...ir, direction: action.direction };

    case "setStateDirection": {
      const s = ir.states.find((x) => x.id === action.id);
      if (!s || s.role !== "normal") return ir;
      const direction = action.direction ?? undefined;
      if (s.direction === direction) return ir;
      return { ...ir, states: ir.states.map((x) => (x.id === action.id ? omitUndefined({ ...x, direction }) : x)) };
    }

    case "addTransition": {
      const t = action.transition;
      if (ir.transitions.some((x) => x.id === t.id)) return ir;
      const known = (id: StateId) => ir.states.some((s) => s.id === id);
      if (!known(t.from) || !known(t.to)) return ir;
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
      const target = ir.states.find((s) => s.id === n.target);
      if (!target || stateNoteRejection(target) !== undefined) return ir;
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
