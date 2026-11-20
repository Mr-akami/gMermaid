import { describe, expect, it } from "vitest";
import type { StateIR, StateId, TransitionId } from "@gmermaid/ir";
import { fixedWidthMeasurer } from "./measurer";
import { COMPOSITE_TITLE_BAND, layoutStateDiagram } from "./statediagram";

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

/** Distance dagre left between the start dot and `Leaf`. */
const startToLeafGap = (source: StateIR): number => {
  const r = layoutStateDiagram(source, fixedWidthMeasurer());
  const box = (id: string) => r.states.find((s) => s.id === id)!.rect;
  return box("Leaf").y - (box("s").y + box("s").h);
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

  // The reported bug: three nested frames all landed on the same left edge and
  // one edge inside the innermost one was ~380px long.
  const nestedIR = (): StateIR => ({
    kind: "state",
    notes: [],
    states: [
      { id: S("state_start"), label: "", role: "start" },
      { id: S("Outer"), label: "Outer", role: "normal" },
      { id: S("state_start_Outer"), label: "", role: "start", parent: S("Outer") },
      { id: S("Middle"), label: "Middle", role: "normal", parent: S("Outer") },
      { id: S("state_start_Middle"), label: "", role: "start", parent: S("Middle") },
      { id: S("Inner"), label: "Inner", role: "normal", parent: S("Middle") },
      { id: S("state_start_Inner"), label: "", role: "start", parent: S("Inner") },
      { id: S("Leaf"), label: "Leaf", role: "normal", parent: S("Inner") },
      { id: S("state_end_Inner"), label: "", role: "end", parent: S("Inner") },
      { id: S("Done"), label: "Done", role: "normal", parent: S("Middle") },
      { id: S("Ready"), label: "Ready", role: "normal", parent: S("Outer") },
      { id: S("state_end"), label: "", role: "end" },
    ],
    transitions: [
      { id: "t1" as TransitionId, from: S("state_start"), to: S("Outer") },
      { id: "t2" as TransitionId, from: S("state_start_Outer"), to: S("Middle") },
      { id: "t3" as TransitionId, from: S("state_start_Middle"), to: S("Inner") },
      { id: "t4" as TransitionId, from: S("state_start_Inner"), to: S("Leaf") },
      { id: "t5" as TransitionId, from: S("Leaf"), to: S("state_end_Inner") },
      { id: "t6" as TransitionId, from: S("Inner"), to: S("Done") },
      { id: "t7" as TransitionId, from: S("Middle"), to: S("Ready") },
      { id: "t8" as TransitionId, from: S("Outer"), to: S("state_end") },
    ],
  });

describe("nested composites", () => {
  it("matches the committed golden layout three levels deep", () => {
    expect(layoutStateDiagram(nestedIR(), fixedWidthMeasurer())).toMatchSnapshot();
  });

  it("insets every frame strictly inside its parent, title band included", () => {
    const result = layoutStateDiagram(nestedIR(), fixedWidthMeasurer());
    const box = (id: string) => result.states.find((s) => s.id === id)!.rect;
    for (const [parent, child] of [
      ["Outer", "Middle"],
      ["Middle", "Inner"],
    ] as const) {
      const p = box(parent);
      const c = box(child);
      expect(c.x).toBeGreaterThan(p.x);
      expect(c.x + c.w).toBeLessThan(p.x + p.w);
      // the child clears the parent title band, so the two titles never collide
      expect(c.y).toBeGreaterThanOrEqual(p.y + COMPOSITE_TITLE_BAND);
      expect(c.y + c.h).toBeLessThan(p.y + p.h);
    }
    // and the leaves clear the innermost title band too
    const inner = box("Inner");
    expect(box("Leaf").y).toBeGreaterThanOrEqual(inner.y + COMPOSITE_TITLE_BAND);
  });

  it("keeps rank separation independent of nesting depth", () => {
    // the same three members, wrapped in one composite and then in three
    const content = (parent: StateId) => [
      { id: S("s"), label: "", role: "start" as const, parent },
      { id: S("Leaf"), label: "Leaf", role: "normal" as const, parent },
      { id: S("e"), label: "", role: "end" as const, parent },
    ];
    const wrapped = (depth: number): StateIR => {
      const chain = Array.from({ length: depth }, (_, i) => S(`C${i}`));
      const states = chain.map((id, i) => ({
        id,
        label: id as string,
        role: "normal" as const,
        ...(i > 0 ? { parent: chain[i - 1]! } : {}),
      }));
      return {
        kind: "state",
        notes: [],
        states: [...states, ...content(chain.at(-1)!)],
        transitions: [
          { id: "a" as TransitionId, from: S("s"), to: S("Leaf") },
          { id: "b" as TransitionId, from: S("Leaf"), to: S("e") },
        ],
      };
    };
    expect(startToLeafGap(wrapped(3))).toBe(startToLeafGap(wrapped(1)));
  });

  it("honours a composite's own direction", () => {
    const sideways: StateIR = {
      kind: "state",
      notes: [],
      states: [
        { id: S("Comp"), label: "Comp", role: "normal", direction: "LR" },
        { id: S("A"), label: "A", role: "normal", parent: S("Comp") },
        { id: S("B"), label: "B", role: "normal", parent: S("Comp") },
        { id: S("Out"), label: "Out", role: "normal" },
      ],
      transitions: [
        { id: "t1" as TransitionId, from: S("A"), to: S("B") },
        { id: "t2" as TransitionId, from: S("Comp"), to: S("Out") },
      ],
    };
    const r = layoutStateDiagram(sideways, fixedWidthMeasurer());
    const box = (id: string) => r.states.find((s) => s.id === id)!.rect;
    // inside the composite the flow runs left to right...
    expect(box("B").x).toBeGreaterThan(box("A").x + box("A").w);
    expect(box("A").y).toBe(box("B").y);
    // ...while the diagram around it stays top-down
    expect(box("Out").y).toBeGreaterThan(box("Comp").y + box("Comp").h);
  });

  it("keeps concurrency regions working inside a nested composite", () => {
    const buried: StateIR = {
      kind: "state",
      notes: [],
      states: [
        { id: S("Outer"), label: "Outer", role: "normal" },
        { id: S("Active"), label: "Active", role: "normal", parent: S("Outer") },
        { id: S("NumOff"), label: "NumOff", role: "normal", parent: S("Active") },
        { id: S("NumOn"), label: "NumOn", role: "normal", parent: S("Active") },
        { id: S("CapsOff"), label: "CapsOff", role: "normal", parent: S("Active"), region: 1 },
      ],
      transitions: [{ id: "t1" as TransitionId, from: S("NumOff"), to: S("NumOn") }],
    };
    const r = layoutStateDiagram(buried, fixedWidthMeasurer());
    expect(r.regions.map((b) => [b.parent, b.index])).toEqual([
      ["Active", 0],
      ["Active", 1],
    ]);
    const frame = r.states.find((s) => s.id === "Active")!.rect;
    const outer = r.states.find((s) => s.id === "Outer")!.rect;
    for (const band of r.regions) {
      expect(band.rect.x).toBeGreaterThanOrEqual(frame.x - 0.001);
      expect(band.rect.x + band.rect.w).toBeLessThanOrEqual(frame.x + frame.w + 0.001);
    }
    // the bands travelled with their composite into the outer frame
    expect(frame.x).toBeGreaterThan(outer.x);
    expect(r.regions[0]!.rect.x).toBeGreaterThan(outer.x);
    expect(r.regionSeparators).toHaveLength(1);
    const sep = r.regionSeparators[0]!;
    expect(sep.x1).toBe(frame.x);
    expect(sep.x2).toBe(frame.x + frame.w);
    expect(sep.y1).toBeGreaterThan(frame.y);
    expect(sep.y1).toBeLessThan(frame.y + frame.h);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});

describe("a composite holds its own transitions", () => {
  // the shape of a real machine: one hub that every step can bail out to,
  // plus a back edge — dagre routes those wide around the members
  const steps: [string, string, string][] = [
    ["preparing", "drawing", "prepare done"],
    ["preparing", "cancelled", "prepare error"],
    ["preparing", "cancelled", "CANCEL"],
    ["preparing", "cancelled", "SUSPENDED from root"],
    ["drawing", "configuring", "DRAWN"],
    ["drawing", "cancelled", "draw error"],
    ["drawing", "cancelled", "CANCEL"],
    ["drawing", "cancelled", "SUSPENDED from root"],
    ["configuring", "saving", "SUBMIT"],
    ["configuring", "discarding", "CANCEL"],
    ["configuring", "discarding", "SUSPENDED from root"],
    ["configuring", "discarding", "configure error"],
    ["saving", "saved", "save done"],
    ["saving", "configuring", "save error"],
    ["discarding", "cancelled", "discard done"],
    ["discarding", "cancelled", "discard error"],
  ];
  const inner = ["preparing", "drawing", "cancelled", "configuring", "saving", "discarding", "saved"];
  const machine: StateIR = {
    kind: "state",
    notes: [],
    states: [
      { id: S("idle"), label: "idle", role: "normal" },
      { id: S("c"), label: "the construction run of one actor", role: "normal" },
      { id: S("state_start_c"), label: "", role: "start", parent: S("c") },
      ...inner.map((id) => ({ id: S(id), label: id, role: "normal" as const, parent: S("c") })),
      { id: S("state_end_c"), label: "", role: "end", parent: S("c") },
    ],
    transitions: [
      { id: "go" as TransitionId, from: S("idle"), to: S("c"), label: "CONSTRUCTION_REQUESTED" },
      { id: "init" as TransitionId, from: S("state_start_c"), to: S("preparing") },
      ...steps.map(([from, to, label], i) => ({ id: `s${i}` as TransitionId, from: S(from), to: S(to), label })),
      { id: "f1" as TransitionId, from: S("saved"), to: S("state_end_c") },
      { id: "f2" as TransitionId, from: S("cancelled"), to: S("state_end_c") },
    ],
  };
  const measure = fixedWidthMeasurer(7);
  const r = layoutStateDiagram(machine, measure);
  const frame = r.states.find((s) => s.id === "c")!.rect;
  const within = (x: number, y: number) =>
    x >= frame.x - 0.5 && x <= frame.x + frame.w + 0.5 && y >= frame.y - 0.5 && y <= frame.y + frame.h + 0.5;
  const innerEdges = r.transitions.filter((t) => t.id.startsWith("s"));

  it("every inner route and label lies inside the frame", () => {
    for (const t of innerEdges) {
      for (const p of t.points) expect(within(p.x, p.y), `${t.id} point ${p.x},${p.y}`).toBe(true);
      const m = measure.measure(t.label!, { fontSize: 12, fontFamily: "sans-serif" });
      const { x, y } = t.labelPos!;
      expect(within(x - m.w / 2, y) && within(x + m.w / 2, y), `${t.id} label`).toBe(true);
    }
  });

  it("the frame is wide enough for its title", () => {
    const small: StateIR = {
      kind: "state",
      notes: [],
      states: [
        { id: S("root"), label: "root machine (one actor)", role: "normal" },
        { id: S("a"), label: "a", role: "normal", parent: S("root") },
      ],
      transitions: [],
    };
    const box = layoutStateDiagram(small, measure).states.find((s) => s.id === "root")!.rect;
    const title = measure.measure("root machine (one actor)", { fontSize: 12, fontFamily: "sans-serif", bold: true });
    expect(box.w).toBeGreaterThanOrEqual(title.w + 20);
  });

  /** Dense points along the uniform B-spline the renderer draws (`edgePath`). */
  const drawn = (pts: readonly { x: number; y: number }[]) => {
    if (pts.length < 3) return Array.from({ length: 65 }, (_, i) => ({ x: pts[0]!.x + ((pts[1]!.x - pts[0]!.x) * i) / 64, y: pts[0]!.y + ((pts[1]!.y - pts[0]!.y) * i) / 64 }));
    let cur = { x: (5 * pts[0]!.x + pts[1]!.x) / 6, y: (5 * pts[0]!.y + pts[1]!.y) / 6 };
    // the straight lead-in from the first point
    const out = Array.from({ length: 17 }, (_, i) => ({ x: pts[0]!.x + ((cur.x - pts[0]!.x) * i) / 16, y: pts[0]!.y + ((cur.y - pts[0]!.y) * i) / 16 }));
    const segs: { x: number; y: number }[][] = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const c = pts[i + 1];
      const end = c === undefined ? b : { x: (a.x + 4 * b.x + c.x) / 6, y: (a.y + 4 * b.y + c.y) / 6 };
      segs.push([{ x: (2 * a.x + b.x) / 3, y: (2 * a.y + b.y) / 3 }, { x: (a.x + 2 * b.x) / 3, y: (a.y + 2 * b.y) / 3 }, end]);
    }
    for (const [c1, c2, e] of segs) {
      for (let j = 0; j <= 64; j++) {
        const t = j / 64;
        const m = 1 - t;
        out.push({
          x: m * m * m * cur.x + 3 * m * m * t * c1!.x + 3 * m * t * t * c2!.x + t * t * t * e!.x,
          y: m * m * m * cur.y + 3 * m * m * t * c1!.y + 3 * m * t * t * c2!.y + t * t * t * e!.y,
        });
      }
      cur = e!;
    }
    return out;
  };

  it("each label sits on the curve that is drawn for its edge", () => {
    for (const t of innerEdges) {
      const d = Math.min(...drawn(t.points).map((q) => Math.hypot(q.x - t.labelPos!.x, q.y - t.labelPos!.y)));
      expect(d, `${t.id} label ${t.label}`).toBeLessThan(2);
    }
  });

  it("a label keeps off other edges' drawn curves when its own curve has room", () => {
    const onOther = innerEdges.filter((t) => {
      const m = measure.measure(t.label!, { fontSize: 12, fontFamily: "sans-serif" });
      const box = { x: t.labelPos!.x - m.w / 2, y: t.labelPos!.y - m.h * 0.8, w: m.w, h: m.h };
      return r.transitions.some(
        (u) => u.id !== t.id && drawn(u.points).some((q) => q.x > box.x && q.x < box.x + box.w && q.y > box.y && q.y < box.y + box.h),
      );
    });
    // `save error` has room on its curve and must use it; `configure error`
    // is wider than any gap between the lines crossing its short curve
    expect(onOther.map((t) => t.label)).not.toContain("save error");
    expect(onOther.length).toBeLessThanOrEqual(1);
  });

  it("no two labels overlap, and none covers a box", () => {
    const rectOf = (t: (typeof innerEdges)[number]) => {
      const m = measure.measure(t.label!, { fontSize: 12, fontFamily: "sans-serif" });
      return { x: t.labelPos!.x - m.w / 2, y: t.labelPos!.y - m.h * 0.8, w: m.w, h: m.h };
    };
    const hit = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const boxes = r.states.filter((s) => !s.composite).map((s) => s.rect);
    innerEdges.forEach((t, i) => {
      for (const u of innerEdges.slice(i + 1)) expect(hit(rectOf(t), rectOf(u)), `${t.label} / ${u.label}`).toBe(false);
      for (const b of boxes) expect(hit(rectOf(t), b), `${t.label} on a box`).toBe(false);
    });
  });
});
