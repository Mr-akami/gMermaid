import type { StateIR, StateNode, StateTransition } from "./statediagram";

// XState v5 detail that mermaid's stateDiagram-v2 grammar has no words for.
// ADR 0002: StateIR stays the single master and BOTH texts are projections of
// it, so everything XState can say that mermaid cannot lives here, hanging off
// the element it belongs to. The canvas, the layout engine and the mermaid
// codegen all ignore these fields; only the XState projection reads them.
//
// The one rule that makes this safe: nothing in here may DUPLICATE something
// the core IR already holds. An event name, a guard and the actions of a
// transition are spelled in `StateTransition.label` (the UML `E [g] / a` form)
// and a state's display name in `StateNode.label` — they are not repeated
// here, because two fields saying the same thing is two masters again.

/** A literal value that survives as data: the JSON subset plus nothing else.
 * Anything an XState config can hold that is NOT this (a function, a call, an
 * identifier reference) is refused by the XState reader with a message. */
export type XValue = null | boolean | number | string | readonly XValue[] | { readonly [key: string]: XValue };

/** XState-only detail of one state node. */
export interface StateNodeXState {
  /** The `states` key, when it cannot be the mermaid id: mermaid ids are
   * global and XState keys are only sibling-unique, and `[*]` has no name at
   * all. Absent = the key is the id. */
  readonly key?: string;
  /** An explicit `id:` on the node — what `#id` targets resolve to. Absent
   * when the projection can emit the id it needs from the mermaid id. */
  readonly xid?: string;
  /** `entry` / `exit` action signatures (`log` or `log({"level":"warn"})`). */
  readonly entry?: readonly string[];
  readonly exit?: readonly string[];
  /** `invoke` entries, carried as literal data. Not drawn on the canvas:
   * an invocation is not a transition and has no box of its own. */
  readonly invoke?: readonly XValue[];
  /** `onDone` transitions of a compound/parallel state, as literal data. */
  readonly onDone?: readonly XValue[];
  readonly tags?: readonly string[];
  readonly meta?: XValue;
  /** `description`, for the nodes that have no mermaid label to put it in:
   * a `[*]` pseudo-state is never named in the text. An ordinary state's
   * description IS its `StateNode.label`, and is not repeated here. */
  readonly description?: string;
  /** `output` of a final state. */
  readonly output?: XValue;
  /** `type: "final"` on a node mermaid draws as an ordinary box, because the
   * region's one `[*]` end was already spoken for. */
  readonly final?: true;
  /** `type: "history"`; mermaid has no history pseudo-state, so the canvas
   * shows an ordinary box. */
  readonly history?: "shallow" | "deep";
  /** Default `target` of a history node. */
  readonly historyTarget?: string;
  /** `type: "parallel"` on a composite with fewer than two regions. Two or
   * more regions ARE parallel in mermaid (`--`), so the flag is only stored
   * for the degenerate case — never as a second opinion about the regions. */
  readonly parallel?: true;
}

/** XState-only detail of one transition. */
export interface StateTransitionXState {
  /** No `target:` at all — an internal transition that only runs actions.
   * Held as a self-transition so the canvas has something to draw. */
  readonly internal?: true;
  /** `reenter: true` — re-run exit/entry even though the target is inside. */
  readonly reenter?: true;
  readonly description?: string;
}

/** Machine-level XState detail: the root state node plus what only the
 * machine has. */
export interface StateMachineXState {
  readonly id?: string;
  /** Raw source text of `context:`. Verbatim on purpose — a context is often
   * a factory function, which is JavaScript we will not interpret. It is
   * carried through unread and re-emitted exactly as written. */
  readonly context?: string;
  /** Raw source text of the argument to `setup({ … })`, same deal: it holds
   * the action/guard/actor IMPLEMENTATIONS, which are functions. */
  readonly setup?: string;
  readonly entry?: readonly string[];
  readonly exit?: readonly string[];
  readonly invoke?: readonly XValue[];
  readonly onDone?: readonly XValue[];
  readonly tags?: readonly string[];
  readonly meta?: XValue;
  readonly output?: XValue;
  readonly description?: string;
  /** `types: { … }`, when it was written as data rather than a TS assertion. */
  readonly types?: XValue;
}

/** True when the IR carries any XState detail the mermaid text cannot hold. */
export function hasXStateDetail(ir: StateIR): boolean {
  return (
    ir.xstate !== undefined ||
    ir.states.some((s) => s.xstate !== undefined) ||
    ir.transitions.some((t) => t.xstate !== undefined)
  );
}

/** Key a transition by what the mermaid text actually says about it. The
 * parser mints `transition-1`, `transition-2`, … from scratch on every parse,
 * so ids cannot survive a re-parse — but `from`, `to` and the label do, and
 * they are what the user typed. Duplicates are disambiguated by occurrence. */
function transitionKeys(transitions: readonly StateTransition[]): string[] {
  const seen = new Map<string, number>();
  return transitions.map((t) => {
    const base = `${t.from}\u0000${t.to}\u0000${t.label ?? ""}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}\u0000${n}`;
  });
}

/**
 * Re-attach the XState detail of `prev` to `next`, a StateIR that was just
 * parsed out of mermaid text.
 *
 * Without this, one keystroke in the mermaid pane would silently delete every
 * entry action, invocation and guard in the diagram: the mermaid parser builds
 * a whole new IR and mermaid has no syntax for any of it. States match by id
 * (mermaid ids ARE the exchange identity), transitions by from/to/label. What
 * does not match is gone on purpose — the user deleted it in the text.
 */
export function mergeXStateDetail(prev: StateIR, next: StateIR): StateIR {
  const nodeXS = new Map(prev.states.filter((s) => s.xstate !== undefined).map((s) => [s.id as string, s.xstate!]));
  const prevKeys = transitionKeys(prev.transitions);
  const transXS = new Map<string, StateTransitionXState>();
  prev.transitions.forEach((t, i) => {
    if (t.xstate !== undefined) transXS.set(prevKeys[i]!, t.xstate);
  });
  const nextKeys = transitionKeys(next.transitions);

  return {
    ...next,
    ...(prev.xstate !== undefined ? { xstate: prev.xstate } : {}),
    states: next.states.map((s) => {
      const xs = nodeXS.get(s.id as string);
      return xs === undefined ? s : { ...s, xstate: xs };
    }),
    transitions: next.transitions.map((t, i) => {
      const xs = transXS.get(nextKeys[i]!);
      return xs === undefined ? t : { ...t, xstate: xs };
    }),
  };
}

/**
 * The mirror image: re-attach the mermaid-only detail of `prev` to `next`, a
 * StateIR that was just read out of XState text.
 *
 * XState has no notes and no layout direction, so committing the XState pane
 * would otherwise wipe both. Notes follow their target state, `direction`
 * follows the state it was written on.
 */
export function mergeMermaidDetail(prev: StateIR, next: StateIR): StateIR {
  const dirs = new Map(prev.states.filter((s) => s.direction !== undefined).map((s) => [s.id as string, s.direction!]));
  const alive = new Set(next.states.map((s) => s.id as string));
  const states: StateNode[] = next.states.map((s) => {
    const d = dirs.get(s.id as string);
    return d === undefined || s.direction !== undefined ? s : { ...s, direction: d };
  });
  return {
    ...next,
    ...(next.direction === undefined && prev.direction !== undefined ? { direction: prev.direction } : {}),
    states,
    notes: prev.notes.filter((n) => alive.has(n.target as string)),
  };
}
