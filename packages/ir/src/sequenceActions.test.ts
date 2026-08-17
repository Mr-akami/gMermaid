import { describe, expect, it } from "vitest";
import type { BranchId, FragmentId, LifelineId, MessageId } from "./ids";
import { applySequenceAction } from "./sequenceActions";
import type { Message, SequenceIR as SeqIR } from "./sequence";

const L = (s: string) => s as LifelineId;
const M = (s: string) => s as MessageId;
const F = (s: string) => s as FragmentId;
const B = (s: string) => s as BranchId;

const msg = (id: string, label = id): Message => ({
  kind: "message",
  id: M(id),
  from: L("a"),
  to: L("b"),
  label,
  arrow: "solid",
});

const base: SeqIR = {
  kind: "sequence",
  lifelines: [
    { id: L("a"), name: "A", isActor: false },
    { id: L("b"), name: "B", isActor: false },
  ],
  events: [
    msg("m1"),
    {
      kind: "fragment",
      id: F("f1"),
      fragmentKind: "alt",
      branches: [
        { id: B("br1"), condition: "ok", events: [msg("m2")] },
        { id: B("br2"), condition: "ng", events: [msg("m3")] },
      ],
    },
    msg("m4"),
  ],
};

describe("fragment property edits", () => {
  it("updateBranch edits a nested branch condition", () => {
    const next = applySequenceAction(base, { type: "updateBranch", id: B("br2"), condition: "fallback" });
    const frag = next.events[1]!;
    if (frag.kind !== "fragment") throw new Error("expected fragment");
    expect(frag.branches[1]!.condition).toBe("fallback");
    expect(frag.branches[0]).toBe((base.events[1] as { branches: readonly unknown[] }).branches[0]);
  });

  it("updateFragment changes the kind, identity-preserving on no-op", () => {
    const next = applySequenceAction(base, { type: "updateFragment", id: F("f1"), fragmentKind: "loop" });
    const frag = next.events[1]!;
    if (frag.kind !== "fragment") throw new Error("expected fragment");
    expect(frag.fragmentKind).toBe("loop");
    expect(applySequenceAction(base, { type: "updateFragment", id: F("f1"), fragmentKind: "alt" })).toBe(base);
  });
});

describe("moveLifeline", () => {
  it("reorders lifelines and preserves identity on no-op", () => {
    const next = applySequenceAction(base, { type: "moveLifeline", id: L("b"), index: 0 });
    expect(next.lifelines.map((l) => l.id)).toEqual(["b", "a"]);
    expect(applySequenceAction(base, { type: "moveLifeline", id: L("a"), index: 0 })).toBe(base);
    expect(applySequenceAction(base, { type: "moveLifeline", id: L("ghost"), index: 0 })).toBe(base);
  });
});

describe("moveEventTo", () => {
  it("reorders at the top level", () => {
    const next = applySequenceAction(base, { type: "moveEventTo", id: M("m4"), container: { kind: "root" }, index: 0 });
    expect(next.events.map((e) => e.id)).toEqual(["m4", "m1", "f1"]);
  });

  it("moves a top-level message into a branch (fragment grows)", () => {
    const next = applySequenceAction(base, {
      type: "moveEventTo",
      id: M("m4"),
      container: { kind: "branch", branchId: B("br2") },
      index: 99,
    });
    expect(next.events.map((e) => e.id)).toEqual(["m1", "f1"]);
    const frag = next.events[1]!;
    if (frag.kind !== "fragment") throw new Error("expected fragment");
    expect(frag.branches[1]!.events.map((e) => e.id)).toEqual(["m3", "m4"]);
  });

  it("moves a branch message out to the root (fragment shrinks)", () => {
    const next = applySequenceAction(base, { type: "moveEventTo", id: M("m3"), container: { kind: "root" }, index: 2 });
    const frag = next.events[1]!;
    if (frag.kind !== "fragment") throw new Error("expected fragment");
    expect(frag.branches[1]!.events).toEqual([]);
    expect(next.events.map((e) => e.id)).toEqual(["m1", "f1", "m3", "m4"]);
  });

  it("rejects moving a fragment into its own branch (returns same reference)", () => {
    expect(
      applySequenceAction(base, {
        type: "moveEventTo",
        id: F("f1"),
        container: { kind: "branch", branchId: B("br1") },
        index: 0,
      }),
    ).toBe(base);
  });

  it("rejects unknown targets (returns same reference)", () => {
    expect(
      applySequenceAction(base, { type: "moveEventTo", id: M("nope"), container: { kind: "root" }, index: 0 }),
    ).toBe(base);
    expect(
      applySequenceAction(base, {
        type: "moveEventTo",
        id: M("m1"),
        container: { kind: "branch", branchId: B("ghost") },
        index: 0,
      }),
    ).toBe(base);
  });
});
