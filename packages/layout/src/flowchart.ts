import dagre from "@dagrejs/dagre";
import type { FlowchartEndpoint, FlowchartIR, SubgraphId } from "@gmermaid/ir";
import type { TextMeasurer } from "./measurer";
import type { EdgePath, FlowchartLayout, NodeBox, Point, SubgraphBox } from "./result";
import { clipPolylineAtRect } from "./compound";

const NODE_PADDING_X = 16;
const NODE_PADDING_Y = 10;
const LABEL_STYLE = { fontSize: 14, fontFamily: "sans-serif" } as const;
// visual breathing room around a cluster; the extra top holds the title
const SUB_PAD = 8;
const SUB_TITLE_H = 24;

export function layoutFlowchart(ir: FlowchartIR, measure: TextMeasurer): FlowchartLayout {
  // multigraph: parallel edges between the same pair are keyed by edge id.
  // compound: subgraphs become dagre clusters.
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: true });
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

  const memberCount = new Map<SubgraphId, number>();
  for (const node of ir.nodes) if (node.parent !== undefined) memberCount.set(node.parent, (memberCount.get(node.parent) ?? 0) + 1);
  for (const s of ir.subgraphs) if (s.parent !== undefined) memberCount.set(s.parent, (memberCount.get(s.parent) ?? 0) + 1);

  // an empty subgraph is not a cluster for dagre — it becomes a plain box
  const emptySubgraphs = new Set(ir.subgraphs.filter((s) => (memberCount.get(s.id) ?? 0) === 0).map((s) => s.id));
  for (const s of ir.subgraphs) {
    if (emptySubgraphs.has(s.id)) {
      const m = measure.measure(s.label, LABEL_STYLE);
      g.setNode(s.id, { width: m.w + NODE_PADDING_X * 2, height: SUB_TITLE_H + NODE_PADDING_Y * 2 });
    } else {
      g.setNode(s.id, {});
    }
  }
  for (const node of ir.nodes) if (node.parent !== undefined) g.setParent(node.id, node.parent);
  for (const s of ir.subgraphs) if (s.parent !== undefined && !emptySubgraphs.has(s.id)) g.setParent(s.id, s.parent);

  // dagre cannot attach edges to clusters: route them to a representative
  // leaf inside, and clip the drawn path at the cluster border afterwards
  const isCluster = (id: FlowchartEndpoint): boolean =>
    ir.subgraphs.some((s) => (s.id as string) === (id as string)) && !emptySubgraphs.has(id as SubgraphId);
  const representative = (id: SubgraphId): string => {
    const node = ir.nodes.find((n) => n.parent === id);
    if (node) return node.id;
    const child = ir.subgraphs.find((s) => s.parent === id);
    if (child) return emptySubgraphs.has(child.id) ? child.id : representative(child.id);
    throw new Error(`layoutFlowchart: cluster ${id} has no members`);
  };
  const anchor = (id: FlowchartEndpoint): string => (isCluster(id) ? representative(id as SubgraphId) : (id as string));

  for (const edge of ir.edges) {
    if (!g.hasNode(edge.from as string) || !g.hasNode(edge.to as string)) {
      throw new Error(`layoutFlowchart: edge ${edge.id} references a missing node`);
    }
    g.setEdge(anchor(edge.from), anchor(edge.to), {}, edge.id);
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

  // cluster rects come back tight around members — expand for border + title
  const depth = (s: { parent?: SubgraphId }): number => {
    let d = 0;
    let cur = s.parent;
    while (cur !== undefined) {
      d += 1;
      cur = ir.subgraphs.find((x) => x.id === cur)?.parent;
    }
    return d;
  };
  const subgraphRect = new Map<SubgraphId, { x: number; y: number; w: number; h: number }>();
  for (const s of ir.subgraphs) {
    const pos = g.node(s.id);
    const grow = emptySubgraphs.has(s.id) ? 0 : SUB_PAD;
    const growTop = emptySubgraphs.has(s.id) ? 0 : SUB_TITLE_H;
    subgraphRect.set(s.id, {
      x: pos.x - pos.width / 2 - grow,
      y: pos.y - pos.height / 2 - growTop,
      w: pos.width + grow * 2,
      h: pos.height + growTop + grow,
    });
  }
  const subgraphs: SubgraphBox[] = ir.subgraphs.map((s) => ({
    id: s.id,
    label: s.label,
    rect: subgraphRect.get(s.id)!,
    depth: depth(s),
  }));

  const edges: EdgePath[] = ir.edges.map((edge) => {
    const e = g.edge(anchor(edge.from), anchor(edge.to), edge.id);
    let points: Point[] = e.points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y }));
    if (isCluster(edge.to)) points = clipPolylineAtRect(points, subgraphRect.get(edge.to as SubgraphId)!, "to");
    if (isCluster(edge.from)) points = clipPolylineAtRect(points, subgraphRect.get(edge.from as SubgraphId)!, "from");
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
  let w = graph.width ?? 0;
  let h = graph.height ?? 0;
  for (const s of subgraphs) {
    w = Math.max(w, s.rect.x + s.rect.w);
    h = Math.max(h, s.rect.y + s.rect.h);
  }
  return {
    kind: "flowchart",
    size: { w, h },
    nodes,
    edges,
    subgraphs,
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
