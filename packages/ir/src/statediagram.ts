import type { StateId, TransitionId } from "./ids";

// State diagrams (stateDiagram-v2), flat form: simple states, [*] start/end
// pseudo-states and labeled transitions. Composite states, <<choice>>/
// <<fork>>/<<join>> and concurrency are out of scope for now.

/** [*] is positional in mermaid text; in the IR it is a state with a role. */
export type StateRole = "normal" | "start" | "end";

export interface StateNode {
  /** Mermaid identifies states by this id in the text — exchange identity,
   * so it must be mermaid-safe (see STATE_NAME_RE). */
  readonly id: StateId;
  /** Display text; codegen emits `state "label" as id` when it differs. */
  readonly label: string;
  readonly role: StateRole;
}

export interface StateTransition {
  readonly id: TransitionId;
  readonly from: StateId;
  readonly to: StateId;
  readonly label?: string;
}

export type StateDirection = "TB" | "LR" | "BT" | "RL";

export interface StateIR {
  readonly kind: "state";
  /** absent = mermaid default (TB) */
  readonly direction?: StateDirection;
  readonly states: readonly StateNode[];
  readonly transitions: readonly StateTransition[];
}

export function emptyStateDiagram(): StateIR {
  return { kind: "state", states: [], transitions: [] };
}
