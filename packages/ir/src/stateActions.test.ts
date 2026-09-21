import { describe, expect, it } from "vitest";
import type { StateId, TransitionId } from "./ids";
import type { StateIR } from "./statediagram";
import { stateRegionCount } from "./statediagram";
import { applyStateAction, newStateId, reparentRejection, STATE_NAME_RE } from "./stateActions";

const S = (s: string) => s as StateId;
const T = (s: string) => s as TransitionId;
const N = (s: string) => s as import("./ids").NoteId;

const base: StateIR = {
  kind: "state",
  notes: [],
  states: [
    { id: S("A"), label: "A", role: "normal" },
    { id: S("B"), label: "B", role: "normal" },
    { id: S("state_start"), label: "", role: "start" },
  ],
  transitions: [{ id: T("t1"), from: S("A"), to: S("B"), label: "go" }],
};

describe("applyStateAction", () => {
  it("removeState cascades to its transitions", () => {
    const next = applyStateAction(base, { type: "removeState", id: S("B") });
    expect(next.states.map((s) => s.id)).toEqual(["A", "state_start"]);
    expect(next.transitions).toEqual([]);
  });

  it("allows only one start and one end pseudo-state", () => {
    const dup = applyStateAction(base, { type: "addState", state: { id: S("s2"), label: "", role: "start" } });
    expect(dup).toBe(base);
    const end = applyStateAction(base, { type: "addState", state: { id: S("e1"), label: "", role: "end" } });
    expect(end.states.some((s) => s.role === "end")).toBe(true);
  });

  it("accepts self-transitions, rejects unknown endpoints", () => {
    const loop = applyStateAction(base, { type: "addTransition", transition: { id: T("t2"), from: S("A"), to: S("A") } });
    expect(loop.transitions).toHaveLength(2);
    expect(applyStateAction(base, { type: "addTransition", transition: { id: T("t2"), from: S("A"), to: S("zzz") } })).toBe(base);
  });

  describe("concurrency regions", () => {
    const comp = applyStateAction(applyStateAction(base, { type: "setStateParent", id: S("A"), parent: S("B") }), {
      type: "addState",
      state: { id: S("C"), label: "C", role: "normal", parent: S("B") },
    });

    it("setStateRegion moves a member into a new region; region 0 is the absent field", () => {
      const split = applyStateAction(comp, { type: "setStateRegion", id: S("C"), region: 1 });
      expect(split.states.find((s) => s.id === "C")).toMatchObject({ parent: "B", region: 1 });
      expect(stateRegionCount(split, S("B"))).toBe(2);
      const back = applyStateAction(split, { type: "setStateRegion", id: S("C"), region: 0 });
      expect("region" in back.states.find((s) => s.id === "C")!).toBe(false);
      // identity on no-op and on a top-level state (no regions outside a block)
      expect(applyStateAction(split, { type: "setStateRegion", id: S("C"), region: 1 })).toBe(split);
      expect(applyStateAction(split, { type: "setStateRegion", id: S("B"), region: 1 })).toBe(split);
    });

    it("compacts region indices so the IR stays round-trippable (mermaid has no empty regions)", () => {
      const sparse = applyStateAction(comp, { type: "setStateRegion", id: S("C"), region: 5 });
      expect(sparse.states.find((s) => s.id === "C")).toMatchObject({ region: 1 });
      // moving the only member of region 0 out leaves C as the sole region -> index 0
      const moved = applyStateAction(sparse, { type: "setStateParent", id: S("A"), parent: null });
      expect("region" in moved.states.find((s) => s.id === "C")!).toBe(false);
      // removing the last member of a region collapses the gap too
      const removed = applyStateAction(sparse, { type: "removeState", id: S("A") });
      expect("region" in removed.states.find((s) => s.id === "C")!).toBe(false);
    });

    it("setStateParent with a region lands in that region; [*] uniqueness is per region", () => {
      const withStart = applyStateAction(comp, {
        type: "addState",
        state: { id: S("s_in"), label: "", role: "start", parent: S("B") },
      });
      // a second start in region 1 of the same block is fine...
      const r1 = applyStateAction(withStart, { type: "setStateParent", id: S("state_start"), parent: S("B"), region: 1 });
      expect(r1.states.find((s) => s.id === "state_start")).toMatchObject({ parent: "B", region: 1 });
      // ...but not in region 0, where one already lives
      expect(reparentRejection(withStart, S("state_start"), S("B"))).toMatch(/already has a start/);
      expect(applyStateAction(withStart, { type: "setStateParent", id: S("state_start"), parent: S("B") })).toBe(withStart);
      // addState rejects a region on a top-level state
      expect(applyStateAction(base, { type: "addState", state: { id: S("X"), label: "X", role: "normal", region: 1 } })).toBe(base);
    });

    it("setStateDirection sets and clears the per-block direction", () => {
      const lr = applyStateAction(comp, { type: "setStateDirection", id: S("B"), direction: "LR" });
      expect(lr.states.find((s) => s.id === "B")).toMatchObject({ direction: "LR" });
      expect(applyStateAction(lr, { type: "setStateDirection", id: S("B"), direction: "LR" })).toBe(lr);
      const cleared = applyStateAction(lr, { type: "setStateDirection", id: S("B"), direction: null });
      expect("direction" in cleared.states.find((s) => s.id === "B")!).toBe(false);
      expect(applyStateAction(comp, { type: "setStateDirection", id: S("state_start"), direction: "LR" })).toBe(comp);
    });
  });

  it("updateTransition clears an emptied label, identity on no-op", () => {
    const cleared = applyStateAction(base, { type: "updateTransition", id: T("t1"), label: "" });
    expect("label" in cleared.transitions[0]!).toBe(false);
    expect(applyStateAction(base, { type: "updateTransition", id: T("t1"), label: "go" })).toBe(base);
  });

  it("newStateId is mermaid-safe (no hyphens)", () => {
    expect(newStateId()).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
  });

  it("removeState on a composite cascades to descendants, their transitions and notes", () => {
    const nested: StateIR = {
      kind: "state",
      states: [
        { id: S("Outer"), label: "Outer", role: "normal" },
        { id: S("Inner"), label: "Inner", role: "normal", parent: S("Outer") },
        { id: S("Leaf"), label: "Leaf", role: "normal", parent: S("Inner") },
        { id: S("Other"), label: "Other", role: "normal" },
      ],
      transitions: [
        { id: T("t1"), from: S("Leaf"), to: S("Other") },
        { id: T("t2"), from: S("Other"), to: S("Outer") },
      ],
      notes: [{ id: N("n1"), target: S("Inner"), position: "rightOf", text: "gone" }],
    };
    const next = applyStateAction(nested, { type: "removeState", id: S("Outer") });
    expect(next.states.map((s) => s.id)).toEqual(["Other"]);
    expect(next.transitions).toEqual([]);
    expect(next.notes).toEqual([]);
  });

  it("scopes start/end uniqueness per container", () => {
    const withComposite = applyStateAction(base, {
      type: "addState",
      state: { id: S("Comp"), label: "Comp", role: "normal" },
    });
    // a start INSIDE the composite coexists with the root-level start
    const inner = applyStateAction(withComposite, {
      type: "addState",
      state: { id: S("s_in"), label: "", role: "start", parent: S("Comp") },
    });
    expect(inner.states.filter((s) => s.role === "start")).toHaveLength(2);
    // …but a second root-level start is still rejected
    expect(applyStateAction(inner, { type: "addState", state: { id: S("s2"), label: "", role: "start" } })).toBe(inner);
  });

  it("setStateParent nests, un-nests and turns the target into a composite", () => {
    const nested = applyStateAction(base, { type: "setStateParent", id: S("A"), parent: S("B") });
    expect(nested.states.find((s) => s.id === "A")).toMatchObject({ parent: "B" });
    // background = top level: parent field disappears entirely
    const out = applyStateAction(nested, { type: "setStateParent", id: S("A"), parent: null });
    expect("parent" in out.states.find((s) => s.id === "A")!).toBe(false);
    // identity on no-op (already at top level)
    expect(applyStateAction(out, { type: "setStateParent", id: S("A"), parent: null })).toBe(out);
  });

  it("reparentRejection names the reason for every invalid move", () => {
    expect(reparentRejection(base, S("A"), S("A"))).toMatch(/itself/);
    expect(reparentRejection(base, S("A"), S("state_start"))).toMatch(/normal state/);
    expect(reparentRejection(base, S("A"), S("zzz"))).toMatch(/unknown target/);
    // cycle: B inside A, then A into B
    const nested = applyStateAction(base, { type: "setStateParent", id: S("B"), parent: S("A") });
    expect(reparentRejection(nested, S("A"), S("B"))).toMatch(/own child/);
    expect(applyStateAction(nested, { type: "setStateParent", id: S("A"), parent: S("B") })).toBe(nested);
    // scoped [*] uniqueness: two starts cannot share a container
    const twoStarts = applyStateAction(base, {
      type: "addState",
      state: { id: S("s_in"), label: "", role: "start", parent: S("A") },
    });
    expect(reparentRejection(twoStarts, S("state_start"), S("A"))).toMatch(/already has a start/);
    // a legal move has no reason
    expect(reparentRejection(base, S("A"), S("B"))).toBeUndefined();
  });

  it("note actions: add requires a target, update/remove are identity-preserving", () => {
    expect(
      applyStateAction(base, { type: "addStateNote", note: { id: N("n1"), target: S("zzz"), position: "rightOf", text: "x" } }),
    ).toBe(base);
    const withNote = applyStateAction(base, {
      type: "addStateNote",
      note: { id: N("n1"), target: S("A"), position: "rightOf", text: "x" },
    });
    expect(withNote.notes).toHaveLength(1);
    expect(applyStateAction(withNote, { type: "updateStateNote", id: N("n1"), text: "x" })).toBe(withNote);
    const moved = applyStateAction(withNote, { type: "updateStateNote", id: N("n1"), position: "leftOf" });
    expect(moved.notes[0]!.position).toBe("leftOf");
    expect(applyStateAction(moved, { type: "removeStateNote", id: N("n1") }).notes).toEqual([]);
  });
});

describe("STATE_NAME_RE", () => {
  it("accepts any-script letters, digits, `_` and `.`; rejects `-`, spaces and a leading digit", () => {
    for (const ok of ["Still", "state_ab12cd34", "日本", "svc.api", "_x"]) expect(STATE_NAME_RE.test(ok), ok).toBe(true);
    for (const bad of ["a-b", "a b", "1a", "", "[*]"]) expect(STATE_NAME_RE.test(bad), bad).toBe(false);
  });
});
