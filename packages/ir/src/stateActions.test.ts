import { describe, expect, it } from "vitest";
import type { StateId, TransitionId } from "./ids";
import type { StateIR } from "./statediagram";
import { applyStateAction, newStateId, reparentRejection } from "./stateActions";

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

  it("rejects self-transitions and unknown endpoints", () => {
    expect(applyStateAction(base, { type: "addTransition", transition: { id: T("t2"), from: S("A"), to: S("A") } })).toBe(base);
    expect(applyStateAction(base, { type: "addTransition", transition: { id: T("t2"), from: S("A"), to: S("zzz") } })).toBe(base);
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
