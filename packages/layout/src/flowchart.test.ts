import { describe, expect, it } from "vitest";
import type { EdgeId, FlowchartIR, NodeId } from "@gmermaid/ir";
import { fixedWidthMeasurer } from "./measurer";
import { layoutFlowchart, SUBGRAPH_TITLE_BAND } from "./flowchart";
import type { FlowchartLayout } from "./result";

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
    { id: "edge-1" as EdgeId, from: "node-1" as NodeId, to: "node-2" as NodeId, line: "solid", headStart: "none", headEnd: "arrow" },
    { id: "edge-2" as EdgeId, from: "node-2" as NodeId, to: "node-3" as NodeId, line: "solid", headStart: "none", headEnd: "arrow", label: "yes" },
  ],
};

const S = (s: string) => s as import("@gmermaid/ir").SubgraphId;

/** Vertical space between the first two nodes of a TB layout. */
const rankGap = (l: FlowchartLayout) => l.nodes[1]!.rect.y - (l.nodes[0]!.rect.y + l.nodes[0]!.rect.h);

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
        { id: "edge-3" as EdgeId, from: "node-1" as NodeId, to: "node-2" as NodeId, line: "dotted", headStart: "none", headEnd: "arrow" },
      ],
    };
    const result = layoutFlowchart(multi, fixedWidthMeasurer());
    expect(result.edges).toHaveLength(3);
    const [first, , third] = result.edges;
    expect(third!.points).not.toEqual(first!.points);
  });

  it("spends edge length as extra ranks (dagre minlen)", () => {
    const short = layoutFlowchart(ir, fixedWidthMeasurer());
    const long: FlowchartIR = {
      ...ir,
      edges: [{ ...ir.edges[0]!, length: 3 }, ir.edges[1]!],
    };
    const result = layoutFlowchart(long, fixedWidthMeasurer());
    expect(rankGap(result)).toBeGreaterThan(rankGap(short));
  });

  it("throws on edges referencing missing nodes", () => {
    const broken: FlowchartIR = {
      ...ir,
      edges: [{ id: "edge-9" as EdgeId, from: "node-1" as NodeId, to: "node-ghost" as NodeId, line: "solid", headStart: "none", headEnd: "arrow" }],
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
      edges: [{ id: "edge-1" as EdgeId, from: "b" as NodeId, to: S("grp"), line: "solid", headStart: "none", headEnd: "arrow" }],
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

// The reported bug: three subgraphs inside each other, and every edge in the
// diagram — even one nowhere near them — stretched, because each dagre cluster
// adds border ranks on every rank it spans.
const N = (s: string) => s as NodeId;
const E = (s: string) => s as EdgeId;

/** `depth` subgraphs inside one another, with a --> b --> c innermost. */
const wrapped = (depth: number): FlowchartIR => {
  const chain = Array.from({ length: depth }, (_, i) => S(`g${i}`));
  return {
    kind: "flowchart",
    direction: "TB",
    subgraphs: chain.map((id, i) => ({ id, label: `G${i}`, ...(i > 0 ? { parent: chain[i - 1]! } : {}) })),
    nodes: ["a", "b", "c"].map((id) => ({ id: N(id), label: id.toUpperCase(), shape: "rect" as const, parent: chain.at(-1)! })),
    edges: [
      { id: E("ab"), from: N("a"), to: N("b"), line: "solid", headStart: "none", headEnd: "arrow" },
      { id: E("bc"), from: N("b"), to: N("c"), line: "solid", headStart: "none", headEnd: "arrow" },
    ],
  };
};

/** Space dagre left between the first two nodes inside the innermost frame. */
const innerRankGap = (source: FlowchartIR): number => {
  const l = layoutFlowchart(source, fixedWidthMeasurer());
  const box = (id: string) => l.nodes.find((n) => n.id === id)!.rect;
  return box("b").y - (box("a").y + box("a").h);
};

describe("nested subgraphs", () => {
  it("matches the committed golden layout three levels deep", () => {
    expect(layoutFlowchart(wrapped(3), fixedWidthMeasurer())).toMatchSnapshot();
  });

  it("keeps rank separation independent of nesting depth", () => {
    expect(innerRankGap(wrapped(3))).toBe(innerRankGap(wrapped(1)));
  });

  it("insets every frame strictly inside its parent, title band included", () => {
    const l = layoutFlowchart(wrapped(3), fixedWidthMeasurer());
    const frame = (id: string) => l.subgraphs.find((s) => s.id === id)!.rect;
    for (const [parent, child] of [
      ["g0", "g1"],
      ["g1", "g2"],
    ] as const) {
      const p = frame(parent);
      const c = frame(child);
      expect(c.x).toBeGreaterThan(p.x);
      expect(c.x + c.w).toBeLessThan(p.x + p.w);
      // the child clears the parent title band, so the two titles never collide
      expect(c.y).toBeGreaterThanOrEqual(p.y + SUBGRAPH_TITLE_BAND);
      expect(c.y + c.h).toBeLessThan(p.y + p.h);
    }
    // and the nodes clear the innermost title band too
    const inner = frame("g2");
    for (const n of l.nodes) expect(n.rect.y).toBeGreaterThanOrEqual(inner.y + SUBGRAPH_TITLE_BAND);
  });

  it("honours a subgraph's own direction", () => {
    const sideways: FlowchartIR = {
      kind: "flowchart",
      direction: "TB",
      subgraphs: [{ id: S("g"), label: "G", direction: "LR" }],
      nodes: [
        { id: N("a"), label: "A", shape: "rect", parent: S("g") },
        { id: N("b"), label: "B", shape: "rect", parent: S("g") },
        { id: N("out"), label: "Out", shape: "rect" },
      ],
      edges: [
        { id: E("ab"), from: N("a"), to: N("b"), line: "solid", headStart: "none", headEnd: "arrow" },
        { id: E("go"), from: S("g"), to: N("out"), line: "solid", headStart: "none", headEnd: "arrow" },
      ],
    };
    const l = layoutFlowchart(sideways, fixedWidthMeasurer());
    const box = (id: string) => l.nodes.find((n) => n.id === id)!.rect;
    const frame = l.subgraphs[0]!.rect;
    // inside the subgraph the flow runs left to right...
    expect(box("b").x).toBeGreaterThan(box("a").x + box("a").w);
    expect(box("a").y).toBe(box("b").y);
    // ...while the diagram around it stays top-down
    expect(box("out").y).toBeGreaterThan(frame.y + frame.h);
  });

  it("carries an edge that crosses a frame on to the node it names", () => {
    const crossing: FlowchartIR = {
      kind: "flowchart",
      direction: "TB",
      subgraphs: [{ id: S("g"), label: "G" }],
      nodes: [
        { id: N("out"), label: "Out", shape: "rect" },
        { id: N("in"), label: "In", shape: "rect", parent: S("g") },
      ],
      edges: [{ id: E("e"), from: N("out"), to: N("in"), line: "solid", headStart: "none", headEnd: "arrow" }],
    };
    const l = layoutFlowchart(crossing, fixedWidthMeasurer());
    const target = l.nodes.find((n) => n.id === "in")!.rect;
    const last = l.edges[0]!.points.at(-1)!;
    // the arrow stops on the node's own border, not on the frame around it
    expect(last.y).toBeCloseTo(target.y, 3);
    expect(last.x).toBeGreaterThanOrEqual(target.x);
    expect(last.x).toBeLessThanOrEqual(target.x + target.w);
  });

  it("gives an empty subgraph a box of its own", () => {
    const empty: FlowchartIR = {
      kind: "flowchart",
      direction: "TB",
      subgraphs: [{ id: S("g"), label: "Nothing here" }],
      nodes: [{ id: N("a"), label: "A", shape: "rect" }],
      edges: [{ id: E("e"), from: N("a"), to: S("g"), line: "solid", headStart: "none", headEnd: "arrow" }],
    };
    const l = layoutFlowchart(empty, fixedWidthMeasurer());
    const frame = l.subgraphs[0]!.rect;
    expect(frame.w).toBeGreaterThan(0);
    expect(frame.h).toBeGreaterThan(SUBGRAPH_TITLE_BAND);
    // an edge naming the subgraph itself ends on that frame
    expect(l.edges[0]!.points.at(-1)!.y).toBeCloseTo(frame.y, 3);
    expect(JSON.parse(JSON.stringify(l))).toEqual(l);
  });
});
