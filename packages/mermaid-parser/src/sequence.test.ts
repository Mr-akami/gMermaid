import { describe, expect, it } from "vitest";
import type { BranchId, FragmentId, LifelineId, MessageId, SequenceIR } from "@gmermaid/ir";
import { sequenceToMermaid } from "@gmermaid/mermaid-codegen";
import { parseSequence } from "./sequence";

const L = (s: string) => s as LifelineId;

describe("parseSequence", () => {
  it("parses participants, messages, and nested fragments", () => {
    const result = parseSequence(
      `sequenceDiagram
  actor a as Alice
  participant b as Bob
  a->>b: hello
  alt is ok
    b-->>a: yes
    opt retry
      a-)b: ping
    end
  else is broken
    b->a: no
  end
`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.lifelines).toEqual([
      { id: "a", name: "Alice", isActor: true },
      { id: "b", name: "Bob", isActor: false },
    ]);
    expect(result.ir.events).toHaveLength(2);
    const frag = result.ir.events[1]!;
    expect(frag.kind).toBe("fragment");
    if (frag.kind !== "fragment") return;
    expect(frag.fragmentKind).toBe("alt");
    expect(frag.branches.map((b) => b.condition)).toEqual(["is ok", "is broken"]);
    expect(frag.branches[0]!.events).toHaveLength(2);
    expect(frag.branches[0]!.events[1]!.kind).toBe("fragment");
  });

  it("reports unclosed fragments and stray else/end", () => {
    const bad = parseSequence(`sequenceDiagram\n  else nope\n  end\n  alt x\n`);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.map((e) => e.message)).toEqual([
      expect.stringContaining("outside a fragment"),
      expect.stringContaining("without an open fragment"),
      expect.stringContaining("unclosed"),
    ]);
  });

  it("trims surrounding whitespace in labels/conditions/names (canonicalization, by design)", () => {
    const result = parseSequence(`sequenceDiagram\n  participant a as   Padded Name  \n  a->>a:   spaced label  \n`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.lifelines[0]!.name).toBe("Padded Name");
    const first = result.ir.events[0]!;
    expect(first.kind === "message" && first.label).toBe("spaced label");
  });

  it("applies a later explicit participant declaration's alias", () => {
    const result = parseSequence(`sequenceDiagram\n  A->>B: hi\n  participant A as Alice\n`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.lifelines.map((l) => [l.id, l.name])).toEqual([
      ["A", "Alice"],
      ["B", "B"],
    ]);
  });

  it("keeps `as` optional: bare participant round-trips via id fallback", () => {
    const result = parseSequence(`sequenceDiagram\n  participant solo\n`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.lifelines[0]).toEqual({ id: "solo", name: "solo", isActor: false });
  });

  it("points unclosed-fragment errors at the opening line", () => {
    const result = parseSequence(`sequenceDiagram\n  alt broken\n  a->>b: x\n  a->>b: y\n`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([{ line: 2, message: expect.stringContaining("unclosed") }]);
  });

  it("parses and round-trips notes", () => {
    const code = `sequenceDiagram
  participant a
  participant b
  a->>b: hi
  Note over a,b: shared note
  Note right of b: side note
`;
    const result = parseSequence(code);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.events.map((e) => e.kind)).toEqual(["message", "note", "note"]);
    const over = result.ir.events[1]!;
    if (over.kind !== "note") return;
    expect(over).toEqual({ kind: "note", id: "note-1", position: "over", lifelines: ["a", "b"], text: "shared note" });
    const back = parseSequence(sequenceToMermaid(result.ir));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.ir).toEqual(result.ir);
  });

  it("round-trips: parse(gen(ir)) == ir, and gen is stable", () => {
    const ir: SequenceIR = {
      kind: "sequence",
      lifelines: [
        { id: L("a"), name: "Alice", isActor: true },
        { id: L("b"), name: "Bob & <co>", isActor: false },
      ],
      events: [
        { kind: "message", id: "message-1" as MessageId, from: L("a"), to: L("b"), label: "hi #1", arrow: "solid" },
        {
          kind: "fragment",
          id: "fragment-1" as FragmentId,
          fragmentKind: "alt",
          branches: [
            {
              id: "branch-1" as BranchId,
              condition: "x > 0",
              events: [
                { kind: "message", id: "message-2" as MessageId, from: L("b"), to: L("a"), label: "ok", arrow: "dotted" },
              ],
            },
            {
              id: "branch-2" as BranchId,
              condition: "otherwise",
              events: [
                { kind: "message", id: "message-3" as MessageId, from: L("b"), to: L("b"), label: "retry", arrow: "async" },
              ],
            },
          ],
        },
      ],
    };
    const code = sequenceToMermaid(ir);
    const back = parseSequence(code);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.ir).toEqual(ir);
    expect(sequenceToMermaid(back.ir)).toBe(code);
  });
});
