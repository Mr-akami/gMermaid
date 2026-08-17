import { describe, expect, it } from "vitest";
import type { EdgeId, FlowchartIR, NodeId } from "@gmermaid/ir";
import { flowchartToMermaid } from "@gmermaid/mermaid-codegen";
import { parseFlowchart } from "./flowchart";

const sortById = <T extends { id: string }>(xs: readonly T[]) => [...xs].toSorted((a, b) => a.id.localeCompare(b.id));

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
  subgraphs: [],
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

  it("round-trips every extended node shape and the invisible link", () => {
    const shapes = [
      "subroutine",
      "cylinder",
      "hexagon",
      "asymmetric",
      "doubleCircle",
      "parallelogram",
      "parallelogramAlt",
      "trapezoid",
      "trapezoidAlt",
    ] as const;
    const ir: FlowchartIR = {
      kind: "flowchart",
  subgraphs: [],
      direction: "TB",
      nodes: shapes.map((shape, i) => ({ id: `n${i}` as NodeId, label: `s ${shape}`, shape })),
      edges: [{ id: "edge-1" as EdgeId, from: "n0" as NodeId, to: "n1" as NodeId, arrow: "invisible" }],
    };
    const code = flowchartToMermaid(ir);
    const back = parseFlowchart(code);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.ir).toEqual(ir);
  });

  it("parses chained edges and `&` fan-out", () => {
    const result = parseFlowchart("flowchart TB\n  a --> b --> c\n  a & b --> d\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.edges.map((e) => [e.from, e.to])).toEqual([
      ["a", "b"],
      ["b", "c"],
      ["a", "d"],
      ["b", "d"],
    ]);
  });

  it("parses `A-- text -->B` inline edge labels", () => {
    const result = parseFlowchart("flowchart TB\n  a-- go -->b\n  b-. maybe .->c\n  c== hard ==>d\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.edges.map((e) => [e.label, e.arrow])).toEqual([
      ["go", "arrow"],
      ["maybe", "dotted"],
      ["hard", "thick"],
    ]);
  });

  it("parses nested subgraphs with titles, direction and edges to a subgraph", () => {
    const code = `flowchart TB
  subgraph s1["Group 1"]
    direction LR
    a["A"] --> b["B"]
    subgraph s2["Inner"]
      c["C"]
    end
  end
  d["D"] --> s1
  b --> d
`;
    const result = parseFlowchart(code);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.subgraphs).toEqual([
      { id: "s1", label: "Group 1", direction: "LR" },
      { id: "s2", label: "Inner", parent: "s1" },
    ]);
    expect(result.ir.nodes.map((n) => [n.id, n.parent])).toEqual([
      ["a", "s1"],
      ["b", "s1"],
      ["c", "s2"],
      ["d", undefined],
    ]);
    expect(result.ir.edges.map((e) => [e.from, e.to])).toEqual([
      ["a", "b"],
      ["d", "s1"], // edge to the subgraph as a whole
      ["b", "d"],
    ]);
    // round trip: blocks regroup members, so node ORDER may shift once —
    // content must survive, and the text form must be a fixpoint after that
    const regen = flowchartToMermaid(result.ir);
    const back = parseFlowchart(regen);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(sortById(back.ir.nodes)).toEqual(sortById(result.ir.nodes));
    expect(back.ir.edges).toEqual(result.ir.edges);
    expect(back.ir.subgraphs).toEqual(result.ir.subgraphs);
    expect(flowchartToMermaid(back.ir)).toBe(regen);
  });

  it("resolves an edge endpoint declared as a subgraph only later", () => {
    const result = parseFlowchart("flowchart TB\n  a --> grp\n  subgraph grp[G]\n    b\n  end\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(result.ir.edges[0]).toMatchObject({ from: "a", to: "grp" });
  });

  it("does not split `&` inside a bracketed label", () => {
    const result = parseFlowchart('flowchart TB\n  a["x & y"] --> b\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.nodes[0]!.label).toBe("x & y");
    expect(result.ir.edges).toHaveLength(1);
  });
});
