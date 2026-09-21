import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { FlowchartLayout } from "@gmermaid/layout";
import type { EdgeId, NodeId } from "@gmermaid/ir";
import { FlowchartView } from "./FlowchartView";

const layout: FlowchartLayout = {
  kind: "flowchart",
  subgraphs: [],
  size: { w: 200, h: 160 },
  nodes: [
    { id: "node-1" as NodeId, label: "Start", shape: "rounded", rect: { x: 60, y: 0, w: 80, h: 40 } },
    { id: "node-2" as NodeId, label: "End", shape: "diamond", rect: { x: 50, y: 100, w: 100, h: 60 } },
  ],
  edges: [
    {
      id: "edge-1" as EdgeId,
      points: [
        { x: 100, y: 40 },
        { x: 100, y: 100 },
      ],
      line: "solid", headStart: "none", headEnd: "arrow",
      label: "go",
      labelPos: { x: 100, y: 70 },
    },
  ],
};

describe("FlowchartView", () => {
  it("matches the committed SVG snapshot", () => {
    const html = renderToStaticMarkup(
      <FlowchartView layout={layout} viewState={{ selectedId: "node-1" }} />,
    );
    expect(html).toMatchSnapshot();
  });

  it("draws a marker at each end and one path per new shape", () => {
    const heads: FlowchartLayout = {
      ...layout,
      nodes: (["doc", "hourglass", "fork", "brace", "crossCirc", "text"] as const).map((shape, i) => ({
        id: `n${i}` as NodeId,
        label: shape,
        shape,
        rect: { x: i * 60, y: 0, w: 50, h: 30 },
      })),
      edges: [
        { id: "e1" as EdgeId, points: [{ x: 0, y: 0 }, { x: 0, y: 50 }], line: "solid", headStart: "circle", headEnd: "cross" },
        { id: "e2" as EdgeId, points: [{ x: 0, y: 0 }, { x: 0, y: 50 }], line: "invisible", headStart: "none", headEnd: "none" },
      ],
    };
    const html = renderToStaticMarkup(<FlowchartView layout={heads} viewState={{}} />);
    expect(html).toContain('marker-start="url(#gm-circle)"');
    expect(html).toContain('marker-end="url(#gm-cross)"');
    // the invisible link draws no marker at all
    expect(html.match(/marker-start=/g)).toHaveLength(1);
    // marker-less shapes (fork, crossCirc) carry no label text
    expect(html).not.toContain(">fork<");
    expect(html).toContain(">doc<");
  });

  it("emits every layout id as a data-element-id (id contract, ADR 0001)", () => {
    const html = renderToStaticMarkup(<FlowchartView layout={layout} viewState={{}} />);
    const domIds = [...html.matchAll(/data-element-id="([^"]+)"/g)].map((m) => m[1]);
    const layoutIds = [...layout.nodes.map((n) => n.id), ...layout.edges.map((e) => e.id)];
    expect(domIds.toSorted()).toEqual(layoutIds.toSorted());
  });
});
