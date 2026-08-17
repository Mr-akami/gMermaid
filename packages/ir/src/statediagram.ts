import type { NoteId, StateId, TransitionId } from "./ids";

// State diagrams (stateDiagram-v2): simple states, [*] start/end
// pseudo-states, <<choice>>/<<fork>>/<<join>>, composite states (a state is
// composite when other states name it as parent) and notes. Concurrency
// (`--` regions) and classDef styling are out of scope. `%%` comments are
// skipped on import — mermaid's own parser discards them too, so they cannot
// survive an IR round trip by design.

/** [*] is positional in mermaid text; in the IR it is a state with a role.
 * choice/fork/join arrive as `state id <<choice>>` etc. */
export type StateRole = "normal" | "start" | "end" | "choice" | "fork" | "join";

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
}

export interface StateTransition {
  readonly id: TransitionId;
  readonly from: StateId;
  readonly to: StateId;
  readonly label?: string;
}

export type StateNotePosition = "leftOf" | "rightOf";

export interface StateNote {
  readonly id: NoteId;
  readonly target: StateId;
  readonly position: StateNotePosition;
  readonly text: string;
}

export type StateDirection = "TB" | "LR" | "BT" | "RL";

export interface StateIR {
  readonly kind: "state";
  /** absent = mermaid default (TB) */
  readonly direction?: StateDirection;
  readonly states: readonly StateNode[];
  readonly transitions: readonly StateTransition[];
  readonly notes: readonly StateNote[];
}

export function emptyStateDiagram(): StateIR {
  return { kind: "state", states: [], transitions: [], notes: [] };
}

/** True when other states live inside this one. */
export function isCompositeState(ir: StateIR, id: StateId): boolean {
  return ir.states.some((s) => s.parent === id);
}
