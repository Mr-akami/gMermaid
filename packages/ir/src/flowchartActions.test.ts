import { describe, expect, it } from "vitest";
import type { EdgeId, NodeId, SubgraphId } from "./ids";
import { applyFlowchartAction, normalizeFlowchartEdge } from "./flowchartActions";
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
  edges: [{ id: e1, from: a, to: b, line: "solid", headStart: "none", headEnd: "arrow" }],
};

const edgeAfter = (ir: FlowchartIR, action: Parameters<typeof applyFlowchartAction>[1]) =>
  applyFlowchartAction(ir, action).edges[0]!;

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
    expect(applyFlowchartAction(base, { type: "updateEdge", id: e1, line: "solid", headEnd: "arrow" })).toBe(base);
    expect(applyFlowchartAction(base, { type: "updateEdge", id: e1, length: 1 })).toBe(base);
    expect(applyFlowchartAction(base, { type: "setDirection", direction: "TB" })).toBe(base);
    expect(applyFlowchartAction(base, { type: "removeEdge", id: "edge-x" as EdgeId })).toBe(base);
  });

  it("updates change only the target", () => {
    const next = applyFlowchartAction(base, { type: "updateNode", id: a, label: "A2", shape: "diamond" });
    expect(next).not.toBe(base);
    expect(next.nodes[0]).toEqual({ id: a, label: "A2", shape: "diamond" });
    expect(next.nodes[1]).toBe(base.nodes[1]);
  });

  it("addEdge defaults to a plain solid arrow", () => {
    const next = applyFlowchartAction(base, { type: "addEdge", id: "edge-2" as EdgeId, from: b, to: a, line: "dotted" });
    expect(next.edges[1]).toEqual({ id: "edge-2", from: b, to: a, line: "dotted", headStart: "none", headEnd: "arrow" });
  });

  it("updateEdge edits line, heads and length; length 1 is stored as absent", () => {
    let next = applyFlowchartAction(base, { type: "updateEdge", id: e1, line: "thick", headStart: "cross", headEnd: "cross", length: 3 });
    expect(next.edges[0]).toEqual({ id: e1, from: a, to: b, line: "thick", headStart: "cross", headEnd: "cross", length: 3 });
    next = applyFlowchartAction(next, { type: "updateEdge", id: e1, length: 1 });
    expect(next.edges[0]).toEqual({ id: e1, from: a, to: b, line: "thick", headStart: "cross", headEnd: "cross" });
    // non-integers and < 1 fall back to the default
    expect(applyFlowchartAction(base, { type: "updateEdge", id: e1, length: 0.5 })).toBe(base);
  });

  // mermaid can only spell a symmetric head pair (`<-->`, `o--o`, `x--x`) and
  // no head at all on `~~~`, so the reducer refuses to hold anything else.
  describe("edge heads stay spellable", () => {
    it("an invisible line clears both heads", () => {
      expect(edgeAfter(base, { type: "updateEdge", id: e1, line: "invisible" })).toEqual({
        id: e1,
        from: a,
        to: b,
        line: "invisible",
        headStart: "none",
        headEnd: "none",
      });
      // …and refuses to take one afterwards
      const invisible = applyFlowchartAction(base, { type: "updateEdge", id: e1, line: "invisible" });
      expect(applyFlowchartAction(invisible, { type: "updateEdge", id: e1, headEnd: "arrow" })).toBe(invisible);
      expect(
        applyFlowchartAction(base, { type: "addEdge", id: "edge-2" as EdgeId, from: b, to: a, line: "invisible" }).edges[1],
      ).toEqual({ id: "edge-2", from: b, to: a, line: "invisible", headStart: "none", headEnd: "none" });
    });

    it("going invisible drops the label: `~~~` has no label slot", () => {
      const labelled = applyFlowchartAction(base, { type: "updateEdge", id: e1, label: "go" });
      const invisible = applyFlowchartAction(labelled, { type: "updateEdge", id: e1, line: "invisible" });
      expect(invisible.edges[0]).not.toHaveProperty("label");
      // and it cannot be given one back while it stays invisible
      expect(applyFlowchartAction(invisible, { type: "updateEdge", id: e1, label: "go" })).toBe(invisible);
    });

    it("changing the start head pulls the end head along", () => {
      expect(edgeAfter(base, { type: "updateEdge", id: e1, headStart: "circle" })).toMatchObject({
        headStart: "circle",
        headEnd: "circle",
      });
    });

    it("changing the end head pulls the start head along, but only once it has one", () => {
      const both = applyFlowchartAction(base, { type: "updateEdge", id: e1, headStart: "circle" });
      expect(edgeAfter(both, { type: "updateEdge", id: e1, headEnd: "cross" })).toMatchObject({
        headStart: "cross",
        headEnd: "cross",
      });
      // clearing the end clears the start with it: `<--` has no token either
      expect(edgeAfter(both, { type: "updateEdge", id: e1, headEnd: "none" })).toMatchObject({
        headStart: "none",
        headEnd: "none",
      });
    });

    it("leaves a one-way arrow alone", () => {
      expect(edgeAfter(base, { type: "updateEdge", id: e1, headEnd: "cross" })).toMatchObject({
        headStart: "none",
        headEnd: "cross",
      });
      expect(normalizeFlowchartEdge(base.edges[0]!)).toBe(base.edges[0]);
    });

    it("preserves identity when the coercion lands back on the current edge", () => {
      const both = applyFlowchartAction(base, { type: "updateEdge", id: e1, headStart: "circle" });
      expect(applyFlowchartAction(both, { type: "updateEdge", id: e1, headStart: "circle" })).toBe(both);
      const oneWay = applyFlowchartAction(base, { type: "updateEdge", id: e1, headEnd: "circle" });
      expect(applyFlowchartAction(oneWay, { type: "updateEdge", id: e1, headStart: "none" })).toBe(oneWay);
    });
  });

  it("updateSubgraph sets and clears direction", () => {
    const g = "grp" as SubgraphId;
    const withSub = applyFlowchartAction(base, { type: "addSubgraph", subgraph: { id: g, label: "G" } });
    let next = applyFlowchartAction(withSub, { type: "updateSubgraph", id: g, direction: "LR" });
    expect(next.subgraphs[0]).toEqual({ id: g, label: "G", direction: "LR" });
    next = applyFlowchartAction(next, { type: "updateSubgraph", id: g, direction: null });
    expect(next.subgraphs[0]).toEqual({ id: g, label: "G" });
    expect(applyFlowchartAction(withSub, { type: "updateSubgraph", id: g, direction: null })).toBe(withSub);
  });
});
