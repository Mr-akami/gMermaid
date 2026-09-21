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

  it("nests one synthetic cluster per concurrency region and separates them", () => {
    const concurrent: StateIR = {
      kind: "state",
      states: [
        { id: S("Active"), label: "Active", role: "normal" },
        { id: S("NumOff"), label: "NumOff", role: "normal", parent: S("Active") },
        { id: S("NumOn"), label: "NumOn", role: "normal", parent: S("Active") },
        { id: S("CapsOff"), label: "CapsOff", role: "normal", parent: S("Active"), region: 1 },
      ],
      transitions: [{ id: "t1" as TransitionId, from: S("NumOff"), to: S("NumOn") }],
      notes: [],
    };
    const result = layoutStateDiagram(concurrent, fixedWidthMeasurer());
    expect(result.regions.map((r) => [r.parent, r.index])).toEqual([
      ["Active", 0],
      ["Active", 1],
    ]);
    const [r0, r1] = result.regions;
    // TB: regions stack along the flow axis, region 0 first
    expect(r0!.rect.y + r0!.rect.h).toBeLessThanOrEqual(r1!.rect.y);
    const frame = result.states.find((s) => s.id === "Active")!.rect;
    for (const band of result.regions) {
      expect(band.rect.x).toBeGreaterThanOrEqual(frame.x - 0.001);
      expect(band.rect.x + band.rect.w).toBeLessThanOrEqual(frame.x + frame.w + 0.001);
    }
    // one divider between the two bands, spanning the frame
    expect(result.regionSeparators).toHaveLength(1);
    const sep = result.regionSeparators[0]!;
    expect(sep.parent).toBe("Active");
    expect(sep.y1).toBe(sep.y2);
    expect(sep.y1).toBeGreaterThan(r0!.rect.y);
    expect(sep.y1).toBeLessThan(r1!.rect.y + r1!.rect.h);
    // members land in their own band
    const inBand = (id: string, band: (typeof result.regions)[number]) => {
      const box = result.states.find((s) => s.id === id)!.rect;
      return box.y >= band.rect.y - 0.001 && box.y + box.h <= band.rect.y + band.rect.h + 0.001;
    };
    expect(inBand("NumOff", r0!)).toBe(true);
    expect(inBand("CapsOff", r1!)).toBe(true);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("synthesizes a loop to the right of the box for a self-transition", () => {
    const loop: StateIR = {
      kind: "state",
      states: [{ id: S("Tick"), label: "Tick", role: "normal" }],
      transitions: [
        { id: "t1" as TransitionId, from: S("Tick"), to: S("Tick"), label: "tick" },
        { id: "t2" as TransitionId, from: S("Tick"), to: S("Tick"), label: "tock" },
      ],
      notes: [],
    };
    const result = layoutStateDiagram(loop, fixedWidthMeasurer());
    const box = result.states[0]!.rect;
    const [t1, t2] = result.transitions;
    expect(t1!.points).toHaveLength(4);
    // the detour leaves and re-enters the right edge
    expect(t1!.points[0]!.x).toBeCloseTo(box.x + box.w);
    expect(t1!.points[3]!.x).toBeCloseTo(box.x + box.w);
    // stacked loops fan outward, and the label sits at the loop
    const reach1 = Math.max(...t1!.points.map((p) => p.x));
    const reach2 = Math.max(...t2!.points.map((p) => p.x));
    expect(reach2).toBeGreaterThan(reach1);
    expect(t1!.labelPos!.x).toBeGreaterThan(reach1);
    // the canvas grows to hold the detour and its label
    expect(result.size.w).toBeGreaterThan(reach2);
  });

  it("sizes a note box per line for multi-line text", () => {
    const withNote = (text: string): StateIR => ({
      kind: "state",
      states: [{ id: S("A"), label: "A", role: "normal" }],
      transitions: [],
      notes: [{ id: N("n1"), target: S("A"), position: "rightOf", text }],
    });
    const one = layoutStateDiagram(withNote("short"), fixedWidthMeasurer()).notes[0]!;
    const three = layoutStateDiagram(withNote("short\nlonger line\nx"), fixedWidthMeasurer()).notes[0]!;
    expect(three.rect.h).toBeGreaterThan(one.rect.h);
    // width follows the WIDEST line, not the joined text
    expect(three.rect.w).toBeLessThan("short\nlonger line\nx".length * 8);
    expect(three.rect.w).toBeGreaterThan(one.rect.w);
  });

  it("returns finite sizes for an empty diagram and pure JSON data", () => {
    const empty = layoutStateDiagram({ kind: "state", states: [], transitions: [], notes: [] }, fixedWidthMeasurer());
    expect(Number.isFinite(empty.size.w)).toBe(true);
    const result = layoutStateDiagram(ir, fixedWidthMeasurer());
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
