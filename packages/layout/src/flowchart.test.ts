import { describe, expect, it } from "vitest";
import type { EdgeId, FlowchartIR, NodeId } from "@gmermaid/ir";
import { fixedWidthMeasurer } from "./measurer";
import { layoutFlowchart } from "./flowchart";

const ir: FlowchartIR = {
  kind: "flowchart",
  direction: "TB",
  nodes: [
    { id: "node-1" as NodeId, label: "Start", shape: "rounded" },
    { id: "node-2" as NodeId, label: "Check", shape: "diamond" },
    { id: "node-3" as NodeId, label: "End", shape: "rounded" },
  ],
  edges: [
    { id: "edge-1" as EdgeId, from: "node-1" as NodeId, to: "node-2" as NodeId, arrow: "arrow" },
    { id: "edge-2" as EdgeId, from: "node-2" as NodeId, to: "node-3" as NodeId, arrow: "arrow", label: "yes" },
  ],
};

describe("layoutFlowchart", () => {
  it("is deterministic and vertically ordered for TB", () => {
    const a = layoutFlowchart(ir, fixedWidthMeasurer());
    const b = layoutFlowchart(ir, fixedWidthMeasurer());
    expect(a).toEqual(b);

    const ys = a.nodes.map((n) => n.rect.y);
    expect(ys[0]!).toBeLessThan(ys[1]!);
    expect(ys[1]!).toBeLessThan(ys[2]!);
    expect(a.edges).toHaveLength(2);
    expect(a.edges[1]!.label).toBe("yes");
  });

  it("matches the committed golden layout", () => {
    expect(layoutFlowchart(ir, fixedWidthMeasurer())).toMatchSnapshot();
  });

  it("keeps parallel edges between the same nodes distinct (multigraph)", () => {
    const multi: FlowchartIR = {
      ...ir,
      edges: [
        ...ir.edges,
        { id: "edge-3" as EdgeId, from: "node-1" as NodeId, to: "node-2" as NodeId, arrow: "dotted" },
      ],
    };
    const result = layoutFlowchart(multi, fixedWidthMeasurer());
    expect(result.edges).toHaveLength(3);
    const [first, , third] = result.edges;
    expect(third!.points).not.toEqual(first!.points);
  });

  it("throws on edges referencing missing nodes", () => {
    const broken: FlowchartIR = {
      ...ir,
      edges: [{ id: "edge-9" as EdgeId, from: "node-1" as NodeId, to: "node-ghost" as NodeId, arrow: "arrow" }],
    };
    expect(() => layoutFlowchart(broken, fixedWidthMeasurer())).toThrow(/missing node/);
  });

  it("returns pure JSON data (ADR 0001 guard)", () => {
    const result = layoutFlowchart(ir, fixedWidthMeasurer());
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
