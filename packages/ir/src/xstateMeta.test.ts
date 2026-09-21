import { describe, expect, it } from "vitest";
import { applyStateAction } from "./stateActions";
import type { StateId, TransitionId } from "./ids";
import type { StateIR } from "./statediagram";
import { hasXStateDetail, mergeMermaidDetail, mergeXStateDetail } from "./xstateMeta";

const S = (s: string) => s as StateId;
const T = (s: string) => s as TransitionId;

const base: StateIR = {
  kind: "state",
  states: [
    { id: S("idle"), label: "idle", role: "normal", xstate: { entry: ["reset"] } },
    { id: S("work"), label: "work", role: "normal", xstate: { exit: ["flush"] } },
  ],
  transitions: [{ id: T("transition-1"), from: S("idle"), to: S("work"), label: "GO", xstate: { reenter: true } }],
  notes: [{ id: "note-1" as never, target: S("idle"), position: "rightOf", text: "keep me" }],
  xstate: { id: "m", setup: "{ actions: { reset: assign({}) } }" },
};

describe("the XState extension of StateIR", () => {
  it("is invisible to a diagram that has none", () => {
    expect(hasXStateDetail({ kind: "state", states: [], transitions: [], notes: [] })).toBe(false);
    expect(hasXStateDetail(base)).toBe(true);
  });

  it("survives the reducer, which never looks at it", () => {
    const next = applyStateAction(base, { type: "updateState", id: S("idle"), label: "waiting" });
    expect(next.states[0]?.xstate?.entry).toEqual(["reset"]);
    expect(next.xstate?.setup).toBe(base.xstate?.setup);
  });

  it("goes away with the state it belonged to", () => {
    const next = applyStateAction(base, { type: "removeState", id: S("work") });
    expect(next.states.map((s) => s.id)).toEqual([S("idle")]);
    expect(next.transitions).toEqual([]);
  });
});

describe("mergeXStateDetail — what a mermaid edit must not destroy", () => {
  /** What the mermaid parser hands back: no XState detail anywhere, fresh
   * transition ids, plus whatever the user typed. */
  const reparsed: StateIR = {
    kind: "state",
    states: [
      { id: S("idle"), label: "idle", role: "normal" },
      { id: S("work"), label: "work", role: "normal" },
    ],
    transitions: [
      { id: T("transition-1"), from: S("idle"), to: S("work"), label: "GO" },
      { id: T("transition-2"), from: S("work"), to: S("idle"), label: "BACK" },
    ],
    notes: [],
  };

  it("re-attaches node, transition and machine detail", () => {
    const merged = mergeXStateDetail(base, reparsed);
    expect(merged.states.map((s) => s.xstate)).toEqual([{ entry: ["reset"] }, { exit: ["flush"] }]);
    expect(merged.transitions[0]?.xstate).toEqual({ reenter: true });
    expect(merged.transitions[1]?.xstate).toBeUndefined();
    expect(merged.xstate).toEqual(base.xstate);
    // the mermaid edit itself is kept
    expect(merged.transitions).toHaveLength(2);
  });

  it("matches transitions by what the text says, not by id", () => {
    const renumbered: StateIR = {
      ...reparsed,
      transitions: [
        { id: T("transition-9"), from: S("work"), to: S("idle"), label: "BACK" },
        { id: T("transition-8"), from: S("idle"), to: S("work"), label: "GO" },
      ],
    };
    const merged = mergeXStateDetail(base, renumbered);
    expect(merged.transitions.find((t) => t.label === "GO")?.xstate).toEqual({ reenter: true });
  });

  it("drops the detail of a state the edit deleted", () => {
    const merged = mergeXStateDetail(base, { ...reparsed, states: [reparsed.states[0]!], transitions: [] });
    expect(merged.states).toHaveLength(1);
    expect(merged.states[0]?.xstate).toEqual({ entry: ["reset"] });
  });
});

describe("mergeMermaidDetail — what an XState edit must not destroy", () => {
  it("brings notes and directions across, dropping notes whose state is gone", () => {
    const withDirection: StateIR = {
      ...base,
      direction: "LR",
      states: [{ ...base.states[0]!, direction: "TB" }, base.states[1]!],
      notes: [
        ...base.notes,
        { id: "note-2" as never, target: S("gone"), position: "leftOf", text: "orphan" },
      ],
    };
    const fromXState: StateIR = {
      kind: "state",
      states: [
        { id: S("idle"), label: "idle", role: "normal" },
        { id: S("work"), label: "work", role: "normal" },
      ],
      transitions: [],
      notes: [],
    };
    const merged = mergeMermaidDetail(withDirection, fromXState);
    expect(merged.direction).toBe("LR");
    expect(merged.states[0]?.direction).toBe("TB");
    expect(merged.notes.map((n) => n.text)).toEqual(["keep me"]);
  });
});
