import type { NoteId, StateId, TransitionId } from "./ids";
import type { StateMachineXState, StateNodeXState, StateTransitionXState } from "./xstateMeta";

// State diagrams (stateDiagram-v2): simple states, [*] start/end
// pseudo-states, <<choice>>/<<fork>>/<<join>>, composite states (a state is
// composite when other states name it as parent), concurrency regions (`--`
// inside a composite), per-block `direction`, notes and self-transitions.
// classDef styling is out of scope. `%%` comments are skipped on import —
// mermaid's own parser discards them too, so they cannot survive an IR round
// trip by design.

/** [*] is positional in mermaid text; in the IR it is a state with a role.
 * choice/fork/join arrive as `state id <<choice>>` etc. */
export type StateRole = "normal" | "start" | "end" | "choice" | "fork" | "join";

export type StateDirection = "TB" | "LR" | "BT" | "RL";

export interface StateNode {
  /** Mermaid identifies states by this id in the text — exchange identity,
   * so it must be mermaid-safe (see STATE_NAME_RE). */
  readonly id: StateId;
  /** Display text; codegen emits `state "label" as id` when it differs.
   * Only meaningful for role "normal" (incl. composites). */
  readonly label: string;
  readonly role: StateRole;
  /** Composite membership: the state whose block this one lives in. */
  readonly parent?: StateId;
  /** Concurrency region inside `parent` (0-based; absent = 0). Regions are
   * defined by their members: mermaid emits nothing for an empty region, so
   * an empty region cannot round-trip and the IR has no way to express one.
   * Indices are kept contiguous by the reducer. */
  readonly region?: number;
  /** `direction X` inside this state's block. Only emitted while the state
   * is composite. */
  readonly direction?: StateDirection;
  /** XState-only detail (entry/exit actions, invoke, final/history/parallel
   * types …). Mermaid cannot spell any of it; see ADR 0002. */
  readonly xstate?: StateNodeXState;
}

export interface StateTransition {
  readonly id: TransitionId;
  readonly from: StateId;
  readonly to: StateId;
  readonly label?: string;
  /** XState-only detail of this transition (internal / reenter). The event,
   * guard and actions live in `label` as `EVENT [guard] / actions`. */
  readonly xstate?: StateTransitionXState;
}

export type StateNotePosition = "leftOf" | "rightOf";

export interface StateNote {
  readonly id: NoteId;
  readonly target: StateId;
  readonly position: StateNotePosition;
  /** `\n` separates lines; codegen switches to the `note … end note` block
   * form. Blank lines and per-line indentation do not survive a round trip
   * (mermaid statements are trimmed). */
  readonly text: string;
}

export interface StateIR {
  readonly kind: "state";
  /** absent = mermaid default (TB) */
  readonly direction?: StateDirection;
  readonly states: readonly StateNode[];
  readonly transitions: readonly StateTransition[];
  readonly notes: readonly StateNote[];
  /** Machine-level XState detail: the machine id, `context`, the verbatim
   * `setup({ … })` argument, and the root node's own actions. */
  readonly xstate?: StateMachineXState;
}

export function emptyStateDiagram(): StateIR {
  return { kind: "state", states: [], transitions: [], notes: [] };
}

/** True when other states live inside this one. */
export function isCompositeState(ir: StateIR, id: StateId): boolean {
  return ir.states.some((s) => s.parent === id);
}

/** Number of concurrency regions a composite currently has (0 for a leaf). */
export function stateRegionCount(ir: StateIR, id: StateId): number {
  let max = -1;
  for (const s of ir.states) if (s.parent === id) max = Math.max(max, s.region ?? 0);
  return max + 1;
}
