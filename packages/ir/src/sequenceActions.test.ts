import { describe, expect, it } from "vitest";
import type { BranchId, FragmentId, LifelineId, MessageId } from "./ids";
import { applySequenceAction } from "./sequenceActions";
import type { Message, SequenceIR as SeqIR } from "./sequence";

const L = (s: string) => s as LifelineId;
const M = (s: string) => s as MessageId;
const F = (s: string) => s as FragmentId;
const B = (s: string) => s as BranchId;
const N = (s: string) => s as import("./ids").NoteId;

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

  it("updateBranch sets, keeps and clears structured loop bounds (B-2)", () => {
    const withBounds = applySequenceAction(base, {
      type: "updateBranch",
      id: B("br1"),
      loopBounds: { min: "1", max: "3" },
    });
    const frag1 = withBounds.events[1]!;
    if (frag1.kind !== "fragment") throw new Error("expected fragment");
    // bounds are structural; the condition keeps its exit text untouched
    expect(frag1.branches[0]).toMatchObject({ condition: "ok", loopBounds: { min: "1", max: "3" } });

    // condition edits leave the bounds alone (loopBounds omitted = keep)
    const condEdit = applySequenceAction(withBounds, { type: "updateBranch", id: B("br1"), condition: "(1,2) foo" });
    const frag2 = condEdit.events[1]!;
    if (frag2.kind !== "fragment") throw new Error("expected fragment");
    expect(frag2.branches[0]!.condition).toBe("(1,2) foo"); // exit text is opaque, never re-parsed
    expect(frag2.branches[0]!.loopBounds).toEqual({ min: "1", max: "3" });

    // identity on no-op
    expect(applySequenceAction(withBounds, { type: "updateBranch", id: B("br1"), loopBounds: { min: "1", max: "3" } })).toBe(withBounds);

    // null clears — the field disappears entirely
    const cleared = applySequenceAction(withBounds, { type: "updateBranch", id: B("br1"), loopBounds: null });
    const frag3 = cleared.events[1]!;
    if (frag3.kind !== "fragment") throw new Error("expected fragment");
    expect("loopBounds" in frag3.branches[0]!).toBe(false);
  });

  it("updateFragment changes the kind, identity-preserving on no-op", () => {
    const next = applySequenceAction(base, { type: "updateFragment", id: F("f1"), fragmentKind: "loop" });
    const frag = next.events[1]!;
    if (frag.kind !== "fragment") throw new Error("expected fragment");
    expect(frag.fragmentKind).toBe("loop");
    expect(applySequenceAction(base, { type: "updateFragment", id: F("f1"), fragmentKind: "alt" })).toBe(base);
  });
});

describe("note anchoring on move", () => {
  const note = (id: string): import("./sequence").Note => ({
    kind: "note",
    id: N(id),
    position: "over",
    lifelines: [L("a"), L("b")],
    text: id,
  });
  // m1, n1 (anchored to m1), m2, m3
  const withNote: SeqIR = {
    ...base,
    events: [msg("m1"), note("n1"), msg("m2"), msg("m3")],
  };

  it("moving a message carries its directly-following note (anchor pair)", () => {
    // move m1 below m2: in post-removal coordinates ([n1, m2, m3]) that is index 2
    const next = applySequenceAction(withNote, { type: "moveEventTo", id: M("m1"), container: { kind: "root" }, index: 2 });
    // the note must still directly follow m1 — not re-anchor to m2
    expect(next.events.map((e) => e.id)).toEqual(["m2", "m1", "n1", "m3"]);
  });

  it("moving a message into a branch brings the note along", () => {
    const withFrag: SeqIR = {
      ...base,
      events: [
        msg("m1"),
        note("n1"),
        { kind: "fragment", id: F("f1"), fragmentKind: "opt", branches: [{ id: B("br1"), condition: "", events: [msg("m2")] }] },
      ],
    };
    const next = applySequenceAction(withFrag, {
      type: "moveEventTo",
      id: M("m1"),
      container: { kind: "branch", branchId: B("br1") },
      index: 0,
    });
    const frag = next.events.find((e) => e.kind === "fragment")!;
    if (frag.kind !== "fragment") throw new Error("expected fragment");
    expect(frag.branches[0]!.events.map((e) => e.id)).toEqual(["m1", "n1", "m2"]);
    expect(next.events.map((e) => e.id)).toEqual(["f1"]);
  });

  it("moving the note itself detaches it (moves alone)", () => {
    const next = applySequenceAction(withNote, { type: "moveEventTo", id: N("n1"), container: { kind: "root" }, index: 3 });
    expect(next.events.map((e) => e.id)).toEqual(["m1", "m2", "m3", "n1"]);
  });
});

describe("removeLifeline cascade", () => {
  it("deletes the lifeline together with its messages and notes, at any depth", () => {
    const irWithNote: SeqIR = {
      ...base,
      events: [
        ...base.events,
        { kind: "note", id: N("n1"), position: "leftOf", lifelines: [L("a")], text: "gone" },
        { kind: "note", id: N("n2"), position: "leftOf", lifelines: [L("b")], text: "stays" },
      ],
    };
    const next = applySequenceAction(irWithNote, { type: "removeLifeline", id: L("a") });
    expect(next.lifelines.map((l) => l.id)).toEqual(["b"]);
    // every message touches a → all gone; the fragment stays as scaffolding (L4)
    const frag = next.events[0]!;
    if (frag.kind !== "fragment") throw new Error("expected fragment");
    expect(frag.branches.every((b) => b.events.length === 0)).toBe(true);
    expect(next.events.map((e) => e.id)).toEqual(["f1", "n2"]);
  });

  it("preserves identity when the lifeline is unknown", () => {
    expect(applySequenceAction(base, { type: "removeLifeline", id: L("zzz") })).toBe(base);
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
