import { describe, expect, it } from "vitest";
import type { EdgeId, FlowchartIR, NodeId } from "@gmermaid/ir";
import { flowchartToMermaid } from "@gmermaid/mermaid-codegen";
import { parseFlowchart } from "./flowchart";

describe("parseFlowchart", () => {
  it("parses the subset codegen emits", () => {
    const result = parseFlowchart(
      `flowchart LR
  a("Start")
  b{"Is valid?"}
  c["End"]
  a --> b
  b -.->|"yes"| c
  b ==>|no| a
`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.direction).toBe("LR");
    expect(result.ir.nodes.map((n) => [n.id, n.label, n.shape])).toEqual([
      ["a", "Start", "rounded"],
      ["b", "Is valid?", "diamond"],
      ["c", "End", "rect"],
    ]);
    expect(result.ir.edges.map((e) => [e.from, e.to, e.arrow, e.label])).toEqual([
      ["a", "b", "arrow", undefined],
      ["b", "c", "dotted", "yes"],
      ["b", "a", "thick", "no"],
    ]);
  });

  it("accepts hand-written variants (graph TD, bare ids, inline decls)", () => {
    const result = parseFlowchart(`graph TD\n  A --> B["hello world"]\n  C\n`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.direction).toBe("TB");
    expect(result.ir.nodes.map((n) => n.id)).toEqual(["A", "B", "C"]);
    expect(result.ir.nodes[0]!.label).toBe("A");
  });

  it("reports errors with line numbers and keeps going", () => {
    const result = parseFlowchart(`flowchart TB\n  a --> b\n  ???\n  a --> a\n`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      { line: 3, message: expect.stringContaining("cannot parse") },
      { line: 4, message: expect.stringContaining("self-loop") },
    ]);
  });

  it("rejects a missing header", () => {
    const result = parseFlowchart("a --> b\n");
    expect(result.ok).toBe(false);
  });

  it("round-trips: parse(gen(ir)) == ir, and gen is stable across the loop", () => {
    const ir: FlowchartIR = {
      kind: "flowchart",
      direction: "LR",
      nodes: [
        { id: "n1" as NodeId, label: 'say "hi" #1', shape: "stadium" },
        { id: "n2" as NodeId, label: "multi\nline", shape: "circle" },
        { id: "n3" as NodeId, label: "plain", shape: "diamond" },
      ],
      edges: [
        { id: "edge-1" as EdgeId, from: "n1" as NodeId, to: "n2" as NodeId, arrow: "dotted", label: "a#b" },
        { id: "edge-2" as EdgeId, from: "n2" as NodeId, to: "n3" as NodeId, arrow: "open" },
      ],
    };
    const code = flowchartToMermaid(ir);
    const back = parseFlowchart(code);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.ir).toEqual(ir);
    expect(flowchartToMermaid(back.ir)).toBe(code);
  });
});
