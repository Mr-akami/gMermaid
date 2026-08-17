import dagre from "@dagrejs/dagre";
import type { FlowchartIR } from "@gmermaid/ir";
import type { TextMeasurer } from "./measurer";
import type { EdgePath, FlowchartLayout, NodeBox, Point } from "./result";

const NODE_PADDING_X = 16;
const NODE_PADDING_Y = 10;
const LABEL_STYLE = { fontSize: 14, fontFamily: "sans-serif" } as const;

export function layoutFlowchart(ir: FlowchartIR, measure: TextMeasurer): FlowchartLayout {
  // multigraph: parallel edges between the same pair are keyed by edge id.
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: ir.direction, nodesep: 40, ranksep: 50 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of ir.nodes) {
    const m = measure.measure(node.label, LABEL_STYLE);
    let w = m.w + NODE_PADDING_X * 2;
    let h = m.h + NODE_PADDING_Y * 2;
    if (node.shape === "diamond") {
      // Diamonds need extra room so the label fits inside the rotated square.
      w *= 1.6;
      h *= 1.6;
    }
    g.setNode(node.id, { width: w, height: h });
  }
  for (const edge of ir.edges) {
    if (!g.hasNode(edge.from) || !g.hasNode(edge.to)) {
      throw new Error(`layoutFlowchart: edge ${edge.id} references a missing node`);
    }
    g.setEdge(edge.from, edge.to, {}, edge.id);
  }

  dagre.layout(g);

  const nodes: NodeBox[] = ir.nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      id: node.id,
      label: node.label,
      shape: node.shape,
      rect: {
        x: pos.x - pos.width / 2,
        y: pos.y - pos.height / 2,
        w: pos.width,
        h: pos.height,
      },
    };
  });

  const edges: EdgePath[] = ir.edges.map((edge) => {
    const e = g.edge(edge.from, edge.to, edge.id);
    const points: Point[] = e.points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y }));
    return {
      id: edge.id,
      points,
      arrow: edge.arrow,
      ...(edge.label !== undefined && points.length > 0
        ? { label: edge.label, labelPos: polylineMidpoint(points) }
        : {}),
    };
  });

  const graph = g.graph();
  return {
    kind: "flowchart",
    size: { w: graph.width ?? 0, h: graph.height ?? 0 },
    nodes,
    edges,
  };
}

/** Point at half the arc length of a polyline. */
function polylineMidpoint(points: readonly Point[]): Point {
  const first = points[0]!;
  if (points.length === 1) return first;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  let remaining = total / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg >= remaining && seg > 0) {
      const t = remaining / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= seg;
  }
  return points[points.length - 1]!;
}
