import { describe, expect, it } from "vitest";
import type { EdgeId, NodeId } from "./ids";
import { applyFlowchartAction } from "./flowchartActions";
import type { FlowchartIR } from "./flowchart";

const a = "node-a" as NodeId;
const b = "node-b" as NodeId;
const e1 = "edge-1" as EdgeId;

const base: FlowchartIR = {
  kind: "flowchart",
  subgraphs: [],
  direction: "TB",
  nodes: [
    { id: a, label: "A", shape: "rect" },
    { id: b, label: "B", shape: "rect" },
  ],
  edges: [{ id: e1, from: a, to: b, arrow: "arrow" }],
};

describe("applyFlowchartAction", () => {
  it("removeNode also removes connected edges", () => {
    const next = applyFlowchartAction(base, { type: "removeNode", id: a });
    expect(next.nodes.map((n) => n.id)).toEqual([b]);
    expect(next.edges).toEqual([]);
  });

  it("rejects self-loop and dangling edges (returns same reference)", () => {
    const ghost = "node-ghost" as NodeId;
    expect(applyFlowchartAction(base, { type: "addEdge", id: "edge-2" as EdgeId, from: a, to: a })).toBe(base);
    expect(applyFlowchartAction(base, { type: "addEdge", id: "edge-2" as EdgeId, from: a, to: ghost })).toBe(base);
  });

  it("is identity-preserving for no-op updates", () => {
    expect(applyFlowchartAction(base, { type: "updateNode", id: a, label: "A" })).toBe(base);
    expect(applyFlowchartAction(base, { type: "updateNode", id: "node-x" as NodeId, label: "X" })).toBe(base);
    expect(applyFlowchartAction(base, { type: "updateEdge", id: e1, arrow: "arrow" })).toBe(base);
    expect(applyFlowchartAction(base, { type: "setDirection", direction: "TB" })).toBe(base);
    expect(applyFlowchartAction(base, { type: "removeEdge", id: "edge-x" as EdgeId })).toBe(base);
  });

  it("updates change only the target", () => {
    const next = applyFlowchartAction(base, { type: "updateNode", id: a, label: "A2", shape: "diamond" });
    expect(next).not.toBe(base);
    expect(next.nodes[0]).toEqual({ id: a, label: "A2", shape: "diamond" });
    expect(next.nodes[1]).toBe(base.nodes[1]);
  });
});
