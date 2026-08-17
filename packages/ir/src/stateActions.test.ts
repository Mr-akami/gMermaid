import { describe, expect, it } from "vitest";
import type { StateId, TransitionId } from "./ids";
import type { StateIR } from "./statediagram";
import { applyStateAction, newStateId } from "./stateActions";

const S = (s: string) => s as StateId;
const T = (s: string) => s as TransitionId;

const base: StateIR = {
  kind: "state",
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
});
