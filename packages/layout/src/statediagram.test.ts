import { describe, expect, it } from "vitest";
import type { StateIR, StateId, TransitionId } from "@gmermaid/ir";
import { fixedWidthMeasurer } from "./measurer";
import { layoutStateDiagram } from "./statediagram";

const S = (s: string) => s as StateId;
const N = (s: string) => s as import("@gmermaid/ir").NoteId;

const ir: StateIR = {
  kind: "state",
  notes: [],
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

  it("lays out composites as clusters and clips transitions at their border", () => {
    const nested: StateIR = {
      kind: "state",
      states: [
        { id: S("state_start"), label: "", role: "start" },
        { id: S("Comp"), label: "Comp", role: "normal" },
        { id: S("Inner"), label: "Inner", role: "normal", parent: S("Comp") },
        { id: S("c1"), label: "", role: "choice" },
      ],
      transitions: [
        { id: "t1" as TransitionId, from: S("state_start"), to: S("Comp") }, // into the composite as a whole
        { id: "t2" as TransitionId, from: S("Inner"), to: S("c1") },
      ],
      notes: [{ id: N("n1"), target: S("c1"), position: "rightOf", text: "pick one" }],
    };
    const result = layoutStateDiagram(nested, fixedWidthMeasurer());
    const comp = result.states.find((s) => s.id === "Comp")!;
    const inner = result.states.find((s) => s.id === "Inner")!;
    expect(comp.composite).toBe(true);
    // the cluster frame encloses its child
    expect(inner.rect.x).toBeGreaterThanOrEqual(comp.rect.x);
    expect(inner.rect.y).toBeGreaterThanOrEqual(comp.rect.y);
    expect(inner.rect.x + inner.rect.w).toBeLessThanOrEqual(comp.rect.x + comp.rect.w);
    expect(inner.rect.y + inner.rect.h).toBeLessThanOrEqual(comp.rect.y + comp.rect.h);
    // the transition into the composite stops AT the frame, not at the leaf inside
    const t1 = result.transitions.find((t) => t.id === "t1")!;
    const last = t1.points[t1.points.length - 1]!;
    expect(Math.abs(last.y - comp.rect.y)).toBeLessThan(0.5);
    // the note sits to the right of its target
    const c1 = result.states.find((s) => s.id === "c1")!;
    const note = result.notes[0]!;
    expect(note.rect.x).toBeGreaterThan(c1.rect.x + c1.rect.w);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("returns finite sizes for an empty diagram and pure JSON data", () => {
    const empty = layoutStateDiagram({ kind: "state", states: [], transitions: [], notes: [] }, fixedWidthMeasurer());
    expect(Number.isFinite(empty.size.w)).toBe(true);
    const result = layoutStateDiagram(ir, fixedWidthMeasurer());
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
