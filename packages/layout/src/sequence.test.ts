import { describe, expect, it } from "vitest";
import type { ActivationId, BoxId, BranchId, FragmentId, LifecycleId, LifelineId, MessageId, SequenceIR } from "@gmermaid/ir";
import { fixedWidthMeasurer } from "./measurer";
import { layoutSequence } from "./sequence";

const L = (s: string) => s as LifelineId;

const ir: SequenceIR = {
  kind: "sequence",
  lifelines: [
    { id: L("a"), name: "Alice", kind: "actor" },
    { id: L("b"), name: "Bob", kind: "participant" },
    { id: L("c"), name: "Charlie", kind: "participant" },
  ],
  boxes: [],
  events: [
    { kind: "message", id: "m1" as MessageId, from: L("a"), to: L("b"), label: "hello", arrow: "solid" },
    {
      kind: "fragment",
      id: "f1" as FragmentId,
      fragmentKind: "alt",
      branches: [
        {
          id: "br1" as BranchId,
          condition: "ok",
          events: [{ kind: "message", id: "m2" as MessageId, from: L("b"), to: L("c"), label: "forward", arrow: "dotted" }],
        },
        {
          id: "br2" as BranchId,
          condition: "fail",
          events: [{ kind: "message", id: "m3" as MessageId, from: L("b"), to: L("a"), label: "sorry", arrow: "solid" }],
        },
      ],
    },
    { kind: "message", id: "m4" as MessageId, from: L("c"), to: L("c"), label: "self", arrow: "async" },
  ],
};

describe("layoutSequence", () => {
  it("matches the committed golden layout", () => {
    expect(layoutSequence(ir, fixedWidthMeasurer())).toMatchSnapshot();
  });

  it("orders rows by event order and nests the fragment around its rows", () => {
    const result = layoutSequence(ir, fixedWidthMeasurer());
    const [m1, m2, m3, m4] = result.messages;
    expect(m1!.y).toBeLessThan(m2!.y);
    expect(m2!.y).toBeLessThan(m3!.y);
    expect(m3!.y).toBeLessThan(m4!.y);

    const frame = result.fragments[0]!;
    expect(frame.rect.y).toBeLessThan(m2!.y);
    expect(frame.rect.y + frame.rect.h).toBeGreaterThan(m3!.y);
    expect(m4!.y).toBeGreaterThan(frame.rect.y + frame.rect.h); // m4 sits outside
    expect(frame.branches[1]!.dividerY).toBeGreaterThan(m2!.y);
    expect(frame.branches[1]!.dividerY).toBeLessThan(m3!.y);
  });

  it("spans fragments over involved lifelines only", () => {
    const result = layoutSequence(ir, fixedWidthMeasurer());
    const frame = result.fragments[0]!;
    const xa = result.lifelines[0]!.x;
    const xc = result.lifelines[2]!.x;
    expect(frame.rect.x).toBeLessThan(xa);
    expect(frame.rect.x + frame.rect.w).toBeGreaterThan(xc);
  });

  it("note reference lines never cross container borders", () => {
    const withNotes: SequenceIR = {
      ...ir,
      events: [
        { kind: "message", id: "m1" as MessageId, from: L("a"), to: L("b"), label: "hi", arrow: "solid" },
        {
          kind: "fragment",
          id: "f1" as FragmentId,
          fragmentKind: "alt",
          branches: [
            {
              id: "br1" as BranchId,
              condition: "x",
              events: [{ kind: "message", id: "m2" as MessageId, from: L("a"), to: L("b"), label: "in", arrow: "solid" }],
            },
            {
              id: "br2" as BranchId,
              condition: "y",
              // a note at the head of a branch must NOT anchor across the divider
              events: [{ kind: "note", id: "n2" as never, position: "over", lifelines: [L("a")], text: "head" }],
            },
          ],
        },
        // a note directly after a fragment must NOT anchor into its inside
        { kind: "note", id: "n1" as never, position: "over", lifelines: [L("a")], text: "after frag" },
        { kind: "message", id: "m3" as MessageId, from: L("a"), to: L("b"), label: "tail", arrow: "solid" },
        { kind: "note", id: "n3" as never, position: "over", lifelines: [L("a")], text: "anchored" },
      ],
    };
    const result = layoutSequence(withNotes, fixedWidthMeasurer());
    const note = (id: string) => result.notes.find((n) => n.id === id)!;
    expect(note("n1").anchor).toBeUndefined();
    expect(note("n2").anchor).toBeUndefined();
    const m3 = result.messages.find((m) => m.id === "m3")!;
    expect(note("n3").anchor).toEqual(expect.objectContaining({ x2: (m3.fromX + m3.toX) / 2, y2: m3.y }));
  });

  it("parents fully enclose nested fragment frames", () => {
    const nested: SequenceIR = {
      ...ir,
      events: [
        {
          kind: "fragment",
          id: "outer" as FragmentId,
          fragmentKind: "alt",
          branches: [
            {
              id: "ob" as BranchId,
              condition: "c",
              events: [
                {
                  kind: "fragment",
                  id: "inner" as FragmentId,
                  fragmentKind: "opt",
                  branches: [
                    {
                      id: "ib" as BranchId,
                      condition: "",
                      events: [
                        { kind: "message", id: "im" as MessageId, from: L("a"), to: L("c"), label: "wide", arrow: "solid" },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = layoutSequence(nested, fixedWidthMeasurer());
    const outer = result.fragments.find((f) => f.id === "outer")!;
    const inner = result.fragments.find((f) => f.id === "inner")!;
    expect(outer.rect.x).toBeLessThan(inner.rect.x);
    expect(outer.rect.x + outer.rect.w).toBeGreaterThan(inner.rect.x + inner.rect.w);
    expect(outer.rect.y).toBeLessThan(inner.rect.y);
    expect(outer.rect.y + outer.rect.h).toBeGreaterThan(inner.rect.y + inner.rect.h);
  });

  it("returns pure JSON data (ADR 0001 guard)", () => {
    const result = layoutSequence(ir, fixedWidthMeasurer());
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

const M = (s: string) => s as MessageId;

describe("layoutSequence activation bars", () => {
  const activated: SequenceIR = {
    ...ir,
    events: [
      { kind: "message", id: M("m1"), from: L("a"), to: L("b"), label: "open", arrow: "solid", activate: "start" },
      { kind: "message", id: M("m2"), from: L("b"), to: L("c"), label: "nested", arrow: "solid", activate: "start" },
      { kind: "message", id: M("m3"), from: L("c"), to: L("b"), label: "inner done", arrow: "dotted", activate: "end" },
      { kind: "message", id: M("m4"), from: L("b"), to: L("a"), label: "done", arrow: "dotted", activate: "end" },
    ],
  };

  it("spans each bar from its start row to its end row", () => {
    const r = layoutSequence(activated, fixedWidthMeasurer());
    expect(r.activations).toHaveLength(2);
    const onB = r.activations.find((a) => a.lifeline === "b")!;
    const onC = r.activations.find((a) => a.lifeline === "c")!;
    const [m1, m2, m3, m4] = r.messages;
    expect(onB.rect.y).toBe(m1!.y);
    expect(onB.rect.y + onB.rect.h).toBe(m4!.y);
    expect(onC.rect.y).toBe(m2!.y);
    expect(onC.rect.y + onC.rect.h).toBe(m3!.y);
  });

  it("offsets a re-entrant bar by its stack depth", () => {
    const reentrant: SequenceIR = {
      ...ir,
      events: [
        { kind: "message", id: M("m1"), from: L("a"), to: L("b"), label: "one", arrow: "solid", activate: "start" },
        { kind: "message", id: M("m2"), from: L("a"), to: L("b"), label: "two", arrow: "solid", activate: "start" },
        { kind: "message", id: M("m3"), from: L("b"), to: L("a"), label: "out", arrow: "dotted", activate: "end" },
      ],
    };
    const r = layoutSequence(reentrant, fixedWidthMeasurer());
    const depths = r.activations.map((a) => a.depth).toSorted();
    expect(depths).toEqual([0, 1]);
    const [d0, d1] = r.activations.toSorted((a, b) => a.depth - b.depth);
    expect(d1!.rect.x).toBeGreaterThan(d0!.rect.x);
  });

  it("runs a standalone `activate` without a matching `deactivate` to the spine end", () => {
    const open: SequenceIR = {
      ...ir,
      events: [
        { kind: "activation", id: "act-1" as ActivationId, lifeline: L("b"), on: true },
        { kind: "message", id: M("m1"), from: L("a"), to: L("b"), label: "x", arrow: "solid" },
      ],
    };
    const r = layoutSequence(open, fixedWidthMeasurer());
    const bar = r.activations[0]!;
    expect(bar.rect.y + bar.rect.h).toBe(r.lifelines[1]!.spineBottom);
  });
});

describe("layoutSequence boxes", () => {
  it("frames the member heads and leaves room for the box title", () => {
    const boxed: SequenceIR = {
      ...ir,
      boxes: [{ id: "box-1" as BoxId, name: "Service", color: "rgb(1,2,3)", lifelines: [L("b"), L("c")] }],
    };
    const r = layoutSequence(boxed, fixedWidthMeasurer());
    const frame = r.boxes[0]!;
    const b = r.lifelines[1]!;
    const c = r.lifelines[2]!;
    expect(frame.rect.x).toBeLessThan(b.headRect.x);
    expect(frame.rect.x + frame.rect.w).toBeGreaterThan(c.headRect.x + c.headRect.w);
    expect(frame.rect.y).toBeLessThan(b.headRect.y); // title band above the heads
    expect(frame.color).toBe("rgb(1,2,3)");
    // heads move down to make room, so the box never covers them
    expect(b.headRect.y).toBeGreaterThan(layoutSequence(ir, fixedWidthMeasurer()).lifelines[1]!.headRect.y);
  });
});

describe("layoutSequence rect / create / destroy", () => {
  it("gives a rect frame a fill and no branch bands", () => {
    const withRect: SequenceIR = {
      ...ir,
      events: [
        {
          kind: "fragment",
          id: "r1" as FragmentId,
          fragmentKind: "rect",
          branches: [
            {
              id: "rb" as BranchId,
              condition: "rgb(0,0,255)",
              events: [{ kind: "message", id: M("m1"), from: L("a"), to: L("b"), label: "x", arrow: "solid" }],
            },
          ],
        },
      ],
    };
    const r = layoutSequence(withRect, fixedWidthMeasurer());
    const frame = r.fragments[0]!;
    expect(frame.fill).toBe("rgb(0,0,255)");
    expect(frame.branches).toEqual([]);
    expect(frame.rect.y).toBeLessThan(r.messages[0]!.y);
  });

  it("drops a created head onto its create row and ends a destroyed spine early", () => {
    const life: SequenceIR = {
      ...ir,
      events: [
        { kind: "message", id: M("m1"), from: L("a"), to: L("b"), label: "x", arrow: "solid" },
        { kind: "create", id: "lc-1" as LifecycleId, lifeline: L("c") },
        { kind: "message", id: M("m2"), from: L("a"), to: L("c"), label: "spawn", arrow: "solid" },
        { kind: "destroy", id: "lc-2" as LifecycleId, lifeline: L("c") },
        { kind: "message", id: M("m3"), from: L("a"), to: L("b"), label: "after", arrow: "solid" },
      ],
    };
    const r = layoutSequence(life, fixedWidthMeasurer());
    const c = r.lifelines[2]!;
    const b = r.lifelines[1]!;
    expect(c.created).toBe(true);
    expect(c.destroyed).toBe(true);
    expect(c.headRect.y).toBeGreaterThan(r.messages[0]!.y); // below the first row
    expect(c.spineTop).toBeLessThan(r.messages[1]!.y);
    expect(c.spineBottom).toBeLessThan(r.messages[2]!.y); // gone before the tail row
    expect(b.destroyed).toBeUndefined();
    expect(b.spineBottom).toBeGreaterThan(c.spineBottom);
  });
});

describe("layoutSequence multi-line text", () => {
  it("grows notes and message rows by line count", () => {
    const one: SequenceIR = {
      ...ir,
      events: [
        { kind: "message", id: M("m1"), from: L("a"), to: L("b"), label: "one", arrow: "solid" },
        { kind: "note", id: "n1" as never, position: "over", lifelines: [L("a")], text: "one" },
        { kind: "message", id: M("m2"), from: L("a"), to: L("b"), label: "tail", arrow: "solid" },
      ],
    };
    const two: SequenceIR = {
      ...one,
      events: [
        { kind: "message", id: M("m1"), from: L("a"), to: L("b"), label: "one\ntwo", arrow: "solid" },
        { kind: "note", id: "n1" as never, position: "over", lifelines: [L("a")], text: "one\ntwo\nthree" },
        { kind: "message", id: M("m2"), from: L("a"), to: L("b"), label: "tail", arrow: "solid" },
      ],
    };
    const r1 = layoutSequence(one, fixedWidthMeasurer());
    const r2 = layoutSequence(two, fixedWidthMeasurer());
    expect(r2.notes[0]!.rect.h).toBeGreaterThan(r1.notes[0]!.rect.h);
    expect(r2.messages[1]!.y).toBeGreaterThan(r1.messages[1]!.y);
    // the label block is lifted so its last line still sits above the arrow
    expect(r2.messages[0]!.labelPos.y).toBeLessThan(r1.messages[0]!.labelPos.y);
    expect(JSON.parse(JSON.stringify(r2))).toEqual(r2);
  });
});
