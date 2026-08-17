import { describe, expect, it } from "vitest";
import type { StateIR, StateId, TransitionId } from "@gmermaid/ir";
import { fixedWidthMeasurer } from "./measurer";
import { layoutStateDiagram } from "./statediagram";

const S = (s: string) => s as StateId;

const ir: StateIR = {
  kind: "state",
  states: [
    { id: S("state_start"), label: "", role: "start" },
    { id: S("Still"), label: "Still", role: "normal" },
    { id: S("state_end"), label: "", role: "end" },
  ],
  transitions: [
    { id: "t1" as TransitionId, from: S("state_start"), to: S("Still") },
    { id: "t2" as TransitionId, from: S("Still"), to: S("state_end"), label: "done" },
  ],
};

describe("layoutStateDiagram", () => {
  it("matches the committed golden layout", () => {
    expect(layoutStateDiagram(ir, fixedWidthMeasurer())).toMatchSnapshot();
  });

  it("gives pseudo-states a small fixed box and labels a mid point", () => {
    const result = layoutStateDiagram(ir, fixedWidthMeasurer());
    const start = result.states.find((s) => s.role === "start")!;
    const still = result.states.find((s) => s.id === "Still")!;
    expect(start.rect.w).toBeLessThan(still.rect.w);
    const labeled = result.transitions.find((t) => t.id === "t2")!;
    expect(labeled.label).toBe("done");
    expect(labeled.labelPos).toBeDefined();
  });

  it("returns finite sizes for an empty diagram and pure JSON data", () => {
    const empty = layoutStateDiagram({ kind: "state", states: [], transitions: [] }, fixedWidthMeasurer());
    expect(Number.isFinite(empty.size.w)).toBe(true);
    const result = layoutStateDiagram(ir, fixedWidthMeasurer());
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
