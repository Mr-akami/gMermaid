import { describe, expect, it } from "vitest";
import type { BoxId, BranchId, FragmentId, LifecycleId, LifelineId, MessageId } from "./ids";
import { applySequenceAction, messageRetargetRejection, normalizeSequenceNote } from "./sequenceActions";
import { findEventPosition, findSequenceEvent } from "./sequenceQuery";
import { emptySequence } from "./sequence";
import type { Message, Note, SequenceIR as SeqIR } from "./sequence";

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
    { id: L("a"), name: "A", kind: "participant" },
    { id: L("b"), name: "B", kind: "participant" },
  ],
  boxes: [],
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
    // only a `loop` header has a `(min,max)` slot, so the bounds live there
    const asLoop = applySequenceAction(base, { type: "updateFragment", id: F("f1"), fragmentKind: "loop" });
    const withBounds = applySequenceAction(asLoop, {
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

  it("loop bounds cannot outlive the loop: nothing else has a `(min,max)` slot", () => {
    const asLoop = applySequenceAction(base, { type: "updateFragment", id: F("f1"), fragmentKind: "loop" });
    const withBounds = applySequenceAction(asLoop, { type: "updateBranch", id: B("br1"), loopBounds: { min: "1", max: "3" } });

    // changing the kind drops them — otherwise `(1,3) ok` would come back as
    // condition text and double itself on the next save
    const asAlt = applySequenceAction(withBounds, { type: "updateFragment", id: F("f1"), fragmentKind: "alt" });
    const frag = asAlt.events[1]!;
    if (frag.kind !== "fragment") throw new Error("expected fragment");
    expect("loopBounds" in frag.branches[0]!).toBe(false);

    // and only the FIRST branch of a loop has the slot at all
    const onSecond = applySequenceAction(asLoop, { type: "updateBranch", id: B("br2"), loopBounds: { min: "1", max: "3" } });
    const frag2 = onSecond.events[1]!;
    if (frag2.kind !== "fragment") throw new Error("expected fragment");
    expect("loopBounds" in frag2.branches[1]!).toBe(false);
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

describe("activation", () => {
  it("updateMessage sets and clears the suffix-form flag", () => {
    const on = applySequenceAction(base, { type: "updateMessage", id: M("m1"), activate: "start" });
    expect(on.events[0]).toMatchObject({ activate: "start" });
    expect(applySequenceAction(on, { type: "updateMessage", id: M("m1"), activate: "start" })).toBe(on);
    const off = applySequenceAction(on, { type: "updateMessage", id: M("m1"), activate: null });
    expect("activate" in off.events[0]!).toBe(false);
  });

  it("addEventAt inserts standalone activation events; unknown lifelines are rejected", () => {
    const A = "activation-1" as import("./ids").ActivationId;
    const next = applySequenceAction(base, {
      type: "addEventAt",
      event: { kind: "activation", id: A, lifeline: L("b"), on: true },
      container: { kind: "root" },
      index: 1,
    });
    expect(next.events.map((e) => e.id)).toEqual(["m1", "activation-1", "f1", "m4"]);
    expect(
      applySequenceAction(base, {
        type: "addEventAt",
        event: { kind: "activation", id: A, lifeline: L("zz"), on: true },
        container: { kind: "root" },
        index: 0,
      }),
    ).toBe(base);
  });
});

const X = (s: string) => s as BoxId;
const E = (s: string) => s as LifecycleId;

describe("boxes", () => {
  const three: SeqIR = {
    ...base,
    lifelines: [...base.lifelines, { id: L("c"), name: "C", kind: "actor" }],
  };

  it("addBox groups lifelines and steals them from other boxes", () => {
    const one = applySequenceAction(three, { type: "addBox", box: { id: X("x1"), name: "G1", lifelines: [L("a"), L("b")] } });
    expect(one.boxes).toEqual([{ id: "x1", name: "G1", lifelines: ["a", "b"] }]);
    const two = applySequenceAction(one, { type: "addBox", box: { id: X("x2"), name: "G2", color: "rgb(1,2,3)", lifelines: [L("b"), L("zz")] } });
    expect(two.boxes).toEqual([
      { id: "x1", name: "G1", lifelines: ["a"] },
      { id: "x2", name: "G2", color: "rgb(1,2,3)", lifelines: ["b"] },
    ]);
    expect(applySequenceAction(two, { type: "addBox", box: { id: X("x1"), name: "dup", lifelines: [] } })).toBe(two);
  });

  it("setLifelineBox keeps box members contiguous and drops emptied boxes", () => {
    const one = applySequenceAction(three, { type: "addBox", box: { id: X("x1"), name: "G1", lifelines: [L("a")] } });
    // c joins a's box: it is moved right after a, ahead of b
    const joined = applySequenceAction(one, { type: "setLifelineBox", id: L("c"), box: X("x1") });
    expect(joined.lifelines.map((l) => l.id)).toEqual(["a", "c", "b"]);
    expect(joined.boxes[0]!.lifelines).toEqual(["a", "c"]);
    expect(applySequenceAction(joined, { type: "setLifelineBox", id: L("c"), box: X("x1") })).toBe(joined);
    const left = applySequenceAction(joined, { type: "setLifelineBox", id: L("a"), box: null });
    expect(left.boxes[0]!.lifelines).toEqual(["c"]);
    const empty = applySequenceAction(left, { type: "setLifelineBox", id: L("c"), box: null });
    expect(empty.boxes).toEqual([]);
    expect(applySequenceAction(empty, { type: "setLifelineBox", id: L("c"), box: null })).toBe(empty);
  });

  it("updateBox / removeBox / removeLifeline cascade", () => {
    const one = applySequenceAction(three, { type: "addBox", box: { id: X("x1"), name: "G1", lifelines: [L("a"), L("c")] } });
    const colored = applySequenceAction(one, { type: "updateBox", id: X("x1"), color: "aqua", name: "Team" });
    expect(colored.boxes[0]).toEqual({ id: "x1", name: "Team", color: "aqua", lifelines: ["a", "c"] });
    const uncolored = applySequenceAction(colored, { type: "updateBox", id: X("x1"), color: null });
    expect("color" in uncolored.boxes[0]!).toBe(false);
    expect(applySequenceAction(uncolored, { type: "updateBox", id: X("x1"), name: "Team" })).toBe(uncolored);
    expect(applySequenceAction(one, { type: "removeLifeline", id: L("a") }).boxes[0]!.lifelines).toEqual(["c"]);
    expect(applySequenceAction(one, { type: "removeBox", id: X("x1") }).boxes).toEqual([]);
    expect(applySequenceAction(one, { type: "removeBox", id: X("nope") })).toBe(one);
  });
});

describe("setLifecycle", () => {
  it("create goes right before the first message touching the lifeline, destroy before the last", () => {
    const created = applySequenceAction(base, { type: "setLifecycle", lifeline: L("b"), which: "create", eventId: E("c1"), on: true });
    expect(created.events.map((e) => e.id)).toEqual(["c1", "m1", "f1", "m4"]);
    const destroyed = applySequenceAction(created, { type: "setLifecycle", lifeline: L("b"), which: "destroy", eventId: E("d1"), on: true });
    expect(destroyed.events.map((e) => e.id)).toEqual(["c1", "m1", "f1", "d1", "m4"]);
    // turning it back off removes the event wherever it sits
    const off = applySequenceAction(destroyed, { type: "setLifecycle", lifeline: L("b"), which: "create", eventId: E("x"), on: false });
    expect(off.events.map((e) => e.id)).toEqual(["m1", "f1", "d1", "m4"]);
    expect(applySequenceAction(off, { type: "setLifecycle", lifeline: L("b"), which: "create", eventId: E("x"), on: false })).toBe(off);
  });

  it("anchors inside a fragment branch when the first message lives there", () => {
    const ir: SeqIR = { ...base, events: [base.events[1]!, msg("m4")] };
    const next = applySequenceAction(ir, { type: "setLifecycle", lifeline: L("a"), which: "create", eventId: E("c1"), on: true });
    const frag = next.events[0]!;
    if (frag.kind !== "fragment") throw new Error("expected fragment");
    expect(frag.branches[0]!.events.map((e) => e.id)).toEqual(["c1", "m2"]);
  });

  it("is a no-op without a message to attach to", () => {
    const lonely: SeqIR = { ...base, lifelines: [...base.lifelines, { id: L("c"), name: "C", kind: "participant" }] };
    expect(applySequenceAction(lonely, { type: "setLifecycle", lifeline: L("c"), which: "create", eventId: E("c1"), on: true })).toBe(lonely);
  });

  // mermaid spans a pair of lifelines with `over` only: `Note left of a,b`
  // is not a line it can read back.
  it("a note keeps only the lifelines its position can spell", () => {
    const withNote = applySequenceAction(base, {
      type: "addEventAt",
      event: { kind: "note", id: N("n1"), position: "over", lifelines: [L("a"), L("b")], text: "hi" },
      container: { kind: "root" },
      index: 0,
    });
    const moved = applySequenceAction(withNote, { type: "updateNote", id: N("n1"), position: "leftOf" });
    const note = moved.events[0]!;
    if (note.kind !== "note") throw new Error("expected note");
    expect(note.lifelines).toEqual([L("a")]);
    // and a third lifeline never gets in, whatever the position
    expect(
      normalizeSequenceNote({ kind: "note", id: N("n2"), position: "over", lifelines: [L("a"), L("b"), L("c")], text: "x" }).lifelines,
    ).toEqual([L("a"), L("b")]);
  });
});

const noteOf = (ir: SeqIR): Note => ir.events[0] as Note;

describe("updateNote retargets a note", () => {
  const threeLifelinesAndANote = (): SeqIR => {
    let ir = emptySequence();
    for (const name of ["A", "B", "C"]) {
      ir = applySequenceAction(ir, {
        type: "addLifeline",
        lifeline: { id: L(name), name, kind: "participant" },
      });
    }
    return applySequenceAction(ir, {
      type: "addEventAt",
      event: { kind: "note", id: N("n1"), position: "over", lifelines: [L("A")], text: "n" },
      container: { kind: "root" },
      index: 0,
    });
  };

  it("moves it to another lifeline", () => {
    const ir = applySequenceAction(threeLifelinesAndANote(), { type: "updateNote", id: N("n1"), lifelines: [L("C")] });
    expect(noteOf(ir).lifelines).toEqual(["C"]);
  });

  it("spans a pair for `over` and keeps the first one otherwise", () => {
    let ir = applySequenceAction(threeLifelinesAndANote(), {
      type: "updateNote",
      id: N("n1"),
      lifelines: [L("C"), L("B")],
    });
    expect(noteOf(ir).lifelines).toEqual(["C", "B"]);
    ir = applySequenceAction(ir, { type: "updateNote", id: N("n1"), position: "leftOf" });
    expect(noteOf(ir).lifelines).toEqual(["C"]);
  });

  it("keeps the old target when asked for an unknown or duplicated one", () => {
    const start = threeLifelinesAndANote();
    for (const lifelines of [[], [L("ghost")], [L("B"), L("B")]]) {
      const ir = applySequenceAction(start, { type: "updateNote", id: N("n1"), lifelines });
      expect(noteOf(ir).lifelines).toEqual(["A"]);
      expect(ir).toBe(start);
    }
  });
});

// A message's ends are lifelines, but its POSITION is the event order — so
// re-pointing one must move the arrow without moving the message.
describe("retargetMessage", () => {
  const withC: SeqIR = { ...base, lifelines: [...base.lifelines, { id: L("c"), name: "C", kind: "actor" }] };

  it("moves one end and keeps the label, arrow and activation", () => {
    const start = applySequenceAction(withC, { type: "updateMessage", id: M("m1"), activate: "start" });
    const next = applySequenceAction(start, { type: "retargetMessage", id: M("m1"), to: L("c") });
    expect(next.events[0]).toEqual({ kind: "message", id: "m1", from: "a", to: "c", label: "m1", arrow: "solid", activate: "start" });
  });

  it("swaps both ends in one action, reversing the arrow in place", () => {
    const next = applySequenceAction(base, { type: "retargetMessage", id: M("m1"), from: L("b"), to: L("a") });
    expect(next.events[0]).toMatchObject({ from: "b", to: "a" });
  });

  it("leaves a message nested in a fragment branch exactly where it was", () => {
    const next = applySequenceAction(withC, { type: "retargetMessage", id: M("m2"), to: L("c") });
    expect(findEventPosition(next, M("m2"))).toEqual(findEventPosition(withC, M("m2")));
    expect(findSequenceEvent(next, M("m2"))).toMatchObject({ from: "a", to: "c" });
  });

  it("allows a self-message", () => {
    const next = applySequenceAction(base, { type: "retargetMessage", id: M("m1"), to: L("a") });
    expect(next.events[0]).toMatchObject({ from: "a", to: "a" });
  });

  it("refuses an unknown lifeline, an unknown/non-message id and a no-op — same reference", () => {
    expect(applySequenceAction(base, { type: "retargetMessage", id: M("m1"), to: L("zzz") })).toBe(base);
    expect(applySequenceAction(base, { type: "retargetMessage", id: M("m1"), from: L("zzz") })).toBe(base);
    expect(applySequenceAction(base, { type: "retargetMessage", id: M("ghost"), to: L("a") })).toBe(base);
    // a fragment id is not a message
    expect(applySequenceAction(base, { type: "retargetMessage", id: F("f1") as unknown as MessageId, to: L("a") })).toBe(base);
    expect(applySequenceAction(base, { type: "retargetMessage", id: M("m1"), from: L("a"), to: L("b") })).toBe(base);
  });

  it("names each refusal, and none for a legal move", () => {
    expect(messageRetargetRejection(base, M("m1"), { from: L("zzz") })).toBe("unknown source lifeline");
    expect(messageRetargetRejection(base, M("m1"), { to: L("zzz") })).toBe("unknown target lifeline");
    expect(messageRetargetRejection(base, M("ghost"), { to: L("a") })).toBe("unknown message");
    expect(messageRetargetRejection(base, F("f1") as unknown as MessageId, { to: L("a") })).toBe("unknown message");
    expect(messageRetargetRejection(base, M("m1"), { to: L("a") })).toBeUndefined();
  });
});
