import { describe, expect, it } from "vitest";
import type { EdgeId, FlowchartIR, NodeId } from "@gmermaid/ir";
import { fixedWidthMeasurer } from "./measurer";
import { layoutFlowchart } from "./flowchart";

const ir: FlowchartIR = {
  kind: "flowchart",
  subgraphs: [],
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

const S = (s: string) => s as import("@gmermaid/ir").SubgraphId;

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

  it("lays out subgraphs as clusters and clips edges to them at the frame", () => {
    const withSub: FlowchartIR = {
      kind: "flowchart",
      direction: "TB",
      nodes: [
        { id: "a" as NodeId, label: "A", shape: "rect", parent: S("grp") },
        { id: "b" as NodeId, label: "B", shape: "rect" },
      ],
      edges: [{ id: "edge-1" as EdgeId, from: "b" as NodeId, to: S("grp"), arrow: "arrow" }],
      subgraphs: [{ id: S("grp"), label: "Group" }],
    };
    const result = layoutFlowchart(withSub, fixedWidthMeasurer());
    const grp = result.subgraphs[0]!;
    const a = result.nodes.find((n) => n.id === "a")!;
    // the frame encloses its member
    expect(a.rect.x).toBeGreaterThanOrEqual(grp.rect.x);
    expect(a.rect.y).toBeGreaterThanOrEqual(grp.rect.y);
    expect(a.rect.y + a.rect.h).toBeLessThanOrEqual(grp.rect.y + grp.rect.h);
    // the edge into the subgraph stops AT its frame border
    const edge = result.edges[0]!;
    const last = edge.points[edge.points.length - 1]!;
    const onBorder =
      Math.abs(last.y - grp.rect.y) < 0.5 ||
      Math.abs(last.y - (grp.rect.y + grp.rect.h)) < 0.5 ||
      Math.abs(last.x - grp.rect.x) < 0.5 ||
      Math.abs(last.x - (grp.rect.x + grp.rect.w)) < 0.5;
    expect(onBorder).toBe(true);
    // canvas covers the expanded frame
    expect(result.size.w).toBeGreaterThanOrEqual(grp.rect.x + grp.rect.w);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
