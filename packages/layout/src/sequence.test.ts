import { describe, expect, it } from "vitest";
import type { BranchId, FragmentId, LifelineId, MessageId, SequenceIR } from "@gmermaid/ir";
import { fixedWidthMeasurer } from "./measurer";
import { layoutSequence } from "./sequence";

const L = (s: string) => s as LifelineId;

const ir: SequenceIR = {
  kind: "sequence",
  lifelines: [
    { id: L("a"), name: "Alice", isActor: true },
    { id: L("b"), name: "Bob", isActor: false },
    { id: L("c"), name: "Charlie", isActor: false },
  ],
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
