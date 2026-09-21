import dagre from "@dagrejs/dagre";
import type {
  EdgeId,
  FlowchartDirection,
  FlowchartIR,
  FlowchartNode,
  FlowchartNodeShape,
  SubgraphId,
} from "@gmermaid/ir";
import { edgeLabelSize } from "./measurer";
import type { TextMeasurer } from "./measurer";
import type { EdgePath, FlowchartLayout, NodeBox, Point, Rect, SubgraphBox } from "./result";
import { bboxOf, borderCrossing } from "./compound";

const NODE_PADDING_X = 16;
const NODE_PADDING_Y = 10;
const LABEL_STYLE = { fontSize: 14, fontFamily: "sans-serif" } as const;
// visual breathing room around a cluster; the extra top holds the title
const SUB_PAD = 8;
/** Height of a subgraph's title band — where the renderer puts the label. */
export const SUBGRAPH_TITLE_BAND = 24;
/** Reserved above the members: the band plus the same padding the other
 * sides get, so a node never sits against the title. */
const SUB_TITLE_H = SUBGRAPH_TITLE_BAND + SUB_PAD;
const NODE_SEP = 40;
const RANK_SEP = 50;
// marker-like shapes carry no label of their own, so they get a fixed box
// instead of one measured from text
const FIXED_SIZE: Partial<Record<FlowchartNodeShape, readonly [number, number]>> = {
  smCirc: [18, 18],
  fCirc: [18, 18],
  crossCirc: [26, 26],
  fork: [80, 12],
};

/** Map key for "no parent" — ids are never empty. */
const ROOT = "";

/** A routed path in the coordinates of the container that produced it. */
interface RoutedEdge {
  points: Point[];
  labelPos: Point;
}

/** Which end of an edge a leg belongs to. */
type End = "from" | "to";

/**
 * The stretch of an edge inside a frame it crosses. dagre only ever sees one
 * container at a time, so an edge reaching into a subgraph is handed to that
 * subgraph's own graph as well, attached to a near-zero PROXY standing in for
 * whatever is outside. That is what keeps the line clear of the boxes it would
 * otherwise cut straight through on its way in.
 */
interface Leg {
  readonly id: EdgeId;
  readonly end: End;
  /** the direct child of the container that the leg reaches */
  readonly target: string;
}

/** The proxy that stands in for the far side of a crossing edge. Not zero:
 * dagre refuses to intersect a rectangle with no area. */
const PROXY_SIZE = { width: 1, height: 1 } as const;

const legKey = (id: EdgeId, end: End, container: string): string => `${id}|${end}|${container}`;
/** Proxy ids live in a namespace mermaid ids cannot reach. */
const proxyId = (id: EdgeId, end: End): string => `\u0000${id}|${end}`;

/**
 * One container laid out on its own — the diagram, or the inside of one
 * subgraph. Coordinates are local: the container's frame sits at (0,0).
 */
interface SubLayout {
  readonly w: number;
  readonly h: number;
  /** every descendant box (nodes and subgraph frames), not the container */
  readonly rects: Map<string, Rect>;
  readonly paths: Map<EdgeId, RoutedEdge>;
  /** by `legKey` — the piece of a crossing edge routed inside one frame */
  readonly legs: Map<string, Point[]>;
}

export function layoutFlowchart(ir: FlowchartIR, measure: TextMeasurer): FlowchartLayout {
  const subById = new Map(ir.subgraphs.map((s) => [s.id as string, s]));
  const nodeById = new Map(ir.nodes.map((n) => [n.id as string, n]));
  const childNodes = new Map<string, FlowchartNode[]>();
  const childSubs = new Map<string, SubgraphId[]>();
  for (const n of ir.nodes) {
    const key = n.parent ?? ROOT;
    childNodes.set(key, [...(childNodes.get(key) ?? []), n]);
  }
  for (const s of ir.subgraphs) {
    const key = s.parent ?? ROOT;
    childSubs.set(key, [...(childSubs.get(key) ?? []), s.id]);
  }
  const parentOf = (id: string): SubgraphId | undefined => (nodeById.get(id) ?? subById.get(id))?.parent;

  for (const edge of ir.edges) {
    for (const end of [edge.from, edge.to] as const) {
      if (!nodeById.has(end as string) && !subById.has(end as string)) {
        throw new Error(`layoutFlowchart: edge ${edge.id} references a missing node`);
      }
    }
  }

  // Which container an edge belongs to: the deepest subgraph (or the diagram)
  // that holds both ends. Inside it the edge runs between the two DIRECT
  // children that contain the ends — a subgraph is a real dagre node here,
  // not a cluster, so dagre stops the line at its frame by itself.
  const containersOf = (id: string): (SubgraphId | undefined)[] => {
    const chain: (SubgraphId | undefined)[] = [];
    let cur = parentOf(id);
    while (cur !== undefined) {
      chain.push(cur);
      cur = parentOf(cur);
    }
    chain.push(undefined);
    return chain;
  };
  const liftTo = (id: string, container: SubgraphId | undefined): string => {
    let cur = id;
    while (parentOf(cur) !== container) cur = parentOf(cur)!;
    return cur;
  };

  interface PlacedEdge {
    readonly id: EdgeId;
    readonly label?: string;
    readonly length?: number;
    /** the boxes dagre connects — the direct children of the container */
    readonly from: string;
    readonly to: string;
  }
  const edgesIn = new Map<string, PlacedEdge[]>();
  const legsIn = new Map<string, Leg[]>();
  /** The frames an edge dives into to reach `target`, outermost first. */
  const diveChain = (target: string, container: SubgraphId | undefined): SubgraphId[] => {
    const chain: SubgraphId[] = [];
    let cur = liftTo(target, container);
    while (cur !== target) {
      chain.push(cur as SubgraphId);
      cur = liftTo(target, cur as SubgraphId);
    }
    return chain;
  };
  const addLegs = (id: EdgeId, end: End, target: string, container: SubgraphId | undefined) => {
    for (const frame of diveChain(target, container)) {
      legsIn.set(frame, [...(legsIn.get(frame) ?? []), { id, end, target: liftTo(target, frame) }]);
    }
  };
  /** Edges between a subgraph and something inside it: there is no container
   * where the two are siblings, so they are drawn by hand. `outward` = the
   * edge leaves the enclosing frame for a box inside it. */
  const nested = new Map<EdgeId, boolean>();
  for (const edge of ir.edges) {
    const from = edge.from as string;
    const to = edge.to as string;
    const extras = { ...(edge.label !== undefined ? { label: edge.label } : {}), ...(edge.length !== undefined ? { length: edge.length } : {}) };
    // a self link is dagre's own detour, drawn in the graph that holds the box
    if (from === to) {
      const key = parentOf(from) ?? ROOT;
      edgesIn.set(key, [...(edgesIn.get(key) ?? []), { id: edge.id, from, to, ...extras }]);
      continue;
    }
    const outer = containersOf(to);
    const container = containersOf(from).find((c) => outer.includes(c));
    const lifted = { from: liftTo(from, container), to: liftTo(to, container) };
    if (lifted.from === lifted.to) {
      nested.set(edge.id, containersOf(to).includes(from as SubgraphId));
      continue;
    }
    const key = container ?? ROOT;
    edgesIn.set(key, [...(edgesIn.get(key) ?? []), { id: edge.id, ...lifted, ...extras }]);
    addLegs(edge.id, "from", from, container);
    addLegs(edge.id, "to", to, container);
  }

  const nodeSize = (node: FlowchartNode): { width: number; height: number } => {
    const m = measure.measure(node.label, LABEL_STYLE);
    let w = m.w + NODE_PADDING_X * 2;
    let h = m.h + NODE_PADDING_Y * 2;
    if (node.shape === "diamond") {
      // Diamonds need extra room so the label fits inside the rotated square.
      w *= 1.6;
      h *= 1.6;
    } else if (node.shape === "tri" || node.shape === "flipTri") {
      // a triangle only holds its label near the base
      w *= 1.6;
      h *= 1.4;
    } else if (FIXED_SIZE[node.shape] !== undefined) {
      const [fw, fh] = FIXED_SIZE[node.shape]!;
      w = node.shape === "fork" ? Math.max(w, fw) : fw;
      h = fh;
    }
    return { width: w, height: h };
  };

  /**
   * Lay out everything directly inside `container` (undefined = the diagram)
   * in a dagre graph of its own, innermost first. A subgraph child enters as a
   * single node the size of its finished contents, so dagre never sees a
   * cluster at all: its compound layout adds border ranks per cluster, which
   * is what made the rank separation grow with nesting depth. The private
   * graph is also what lets a subgraph honour its own `direction`.
   */
  const layoutContainer = (container: SubgraphId | undefined, dir: FlowchartDirection): SubLayout => {
    const kidNodes = childNodes.get(container ?? ROOT) ?? [];
    const kidSubs = childSubs.get(container ?? ROOT) ?? [];
    // an empty subgraph has nothing to measure: it becomes a plain titled box
    if (container !== undefined && kidNodes.length === 0 && kidSubs.length === 0) {
      const m = measure.measure(subById.get(container)!.label, LABEL_STYLE);
      return {
        w: m.w + NODE_PADDING_X * 2,
        h: SUB_TITLE_H + NODE_PADDING_Y * 2,
        rects: new Map(),
        paths: new Map(),
        legs: new Map(),
      };
    }

    // multigraph: parallel edges between the same pair are keyed by edge id
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setGraph({ rankdir: dir, nodesep: NODE_SEP, ranksep: RANK_SEP });
    g.setDefaultEdgeLabel(() => ({}));

    for (const n of kidNodes) g.setNode(n.id, nodeSize(n));
    const subs = new Map<SubgraphId, SubLayout>();
    for (const id of kidSubs) {
      const sub = layoutContainer(id, subById.get(id)!.direction ?? dir);
      subs.set(id, sub);
      g.setNode(id, { width: sub.w, height: sub.h });
    }

    // an edge crossing this frame is routed inside it too, from a proxy that
    // stands for everything outside
    const legs = container !== undefined ? (legsIn.get(container) ?? []) : [];
    for (const leg of legs) {
      const proxy = proxyId(leg.id, leg.end);
      g.setNode(proxy, PROXY_SIZE);
      if (leg.end === "to") g.setEdge(proxy, leg.target, {}, `${leg.id}|leg`);
      else g.setEdge(leg.target, proxy, {}, `${leg.id}|leg`);
    }

    const edges = edgesIn.get(container ?? ROOT) ?? [];
    for (const e of edges) {
      // `--->` spans extra ranks: that is dagre's minlen. Telling dagre the
      // label's measured size makes it reserve a rank-sized gap for it, which
      // is what keeps a long label off the nodes it runs between.
      g.setEdge(e.from, e.to, { minlen: e.length ?? 1, ...edgeLabelSize(e.label, measure, LABEL_STYLE) }, e.id);
    }

    dagre.layout(g);

    const local = new Map<string, Rect>();
    for (const id of [...kidNodes.map((n) => n.id as string), ...kidSubs.map((s) => s as string)]) {
      const p = g.node(id);
      local.set(id, { x: p.x - p.width / 2, y: p.y - p.height / 2, w: p.width, h: p.height });
    }

    const legRoutes = new Map<string, Point[]>();
    for (const leg of legs) {
      const proxy = proxyId(leg.id, leg.end);
      const e = leg.end === "to" ? g.edge(proxy, leg.target, `${leg.id}|leg`) : g.edge(leg.target, proxy, `${leg.id}|leg`);
      legRoutes.set(legKey(leg.id, leg.end, container!), e.points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y })));
    }

    const routed = new Map<EdgeId, RoutedEdge>();
    // what the frame has to clear, beyond the boxes: a route dagre bent
    // around a node, and the label it hung on that route
    const overhang: Rect[] = [];
    for (const e of edges) {
      const de = g.edge(e.from, e.to, e.id);
      const points: Point[] = de.points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y }));
      // dagre positions a sized label itself; fall back to the midpoint for
      // the edges it routes without one (self links)
      const sized = typeof de.x === "number" && typeof de.y === "number";
      const labelPos = sized ? { x: de.x as number, y: de.y as number } : polylineMidpoint(points);
      routed.set(e.id, { points, labelPos });
      for (const p of points) overhang.push({ x: p.x, y: p.y, w: 0, h: 0 });
      if (sized && typeof de.width === "number" && typeof de.height === "number") {
        overhang.push({ x: de.x - de.width / 2, y: de.y - de.height / 2, w: de.width, h: de.height });
      }
    }

    // The frame wraps its DIRECT children — a nested subgraph by its finished
    // box, not by the nodes inside it — so every level insets by its own
    // padding and its title band stays clear.
    const graph = g.graph();
    const framed = container !== undefined;
    const inner = bboxOf([
      ...local.values(),
      ...overhang,
      ...[...legRoutes.values()].flat().map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })),
    ]);
    const offX = framed ? SUB_PAD - inner.x : 0;
    const offY = framed ? SUB_TITLE_H - inner.y : 0;
    const w = framed ? inner.w + SUB_PAD * 2 : Number.isFinite(graph.width) ? graph.width! : 0;
    const h = framed ? inner.h + SUB_TITLE_H + SUB_PAD : Number.isFinite(graph.height) ? graph.height! : 0;

    const rects = new Map<string, Rect>();
    for (const [id, r] of local) rects.set(id, { ...r, x: r.x + offX, y: r.y + offY });

    const legPaths = new Map<string, Point[]>();
    for (const [key, pts] of legRoutes) legPaths.set(key, pts.map((p) => ({ x: p.x + offX, y: p.y + offY })));

    const paths = new Map<EdgeId, RoutedEdge>();
    for (const [id, p] of routed) {
      paths.set(id, {
        points: p.points.map((q) => ({ x: q.x + offX, y: q.y + offY })),
        labelPos: { x: p.labelPos.x + offX, y: p.labelPos.y + offY },
      });
    }

    // paste each nested subgraph's own layout in behind its box
    for (const id of kidSubs) {
      const box = rects.get(id)!;
      const sub = subs.get(id)!;
      for (const [childId, r] of sub.rects) rects.set(childId, { ...r, x: r.x + box.x, y: r.y + box.y });
      for (const [edgeId, p] of sub.paths) {
        paths.set(edgeId, {
          points: p.points.map((q) => ({ x: q.x + box.x, y: q.y + box.y })),
          labelPos: { x: p.labelPos.x + box.x, y: p.labelPos.y + box.y },
        });
      }
      for (const [key, pts] of sub.legs) legPaths.set(key, pts.map((q) => ({ x: q.x + box.x, y: q.y + box.y })));
    }

    return { w, h, rects, paths, legs: legPaths };
  };

  const root = layoutContainer(undefined, ir.direction);
  const rectOf = (id: string): Rect => root.rects.get(id)!;

  const nodes: NodeBox[] = ir.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    shape: node.shape,
    rect: rectOf(node.id),
  }));

  const depth = (s: { parent?: SubgraphId }): number => {
    let d = 0;
    let cur = s.parent;
    while (cur !== undefined) {
      d += 1;
      cur = subById.get(cur)?.parent;
    }
    return d;
  };
  const subgraphs: SubgraphBox[] = ir.subgraphs.map((s) => ({
    id: s.id,
    label: s.label,
    rect: rectOf(s.id),
    depth: depth(s),
  }));

  const edges: EdgePath[] = ir.edges.map((edge) => {
    const head = { id: edge.id, line: edge.line, headStart: edge.headStart, headEnd: edge.headEnd };
    const points = pointsFor(edge.id, edge.from as string, edge.to as string);
    return {
      ...head,
      points,
      ...(edge.label !== undefined && points.length > 0
        ? { label: edge.label, labelPos: labelPosFor(edge.id, points) }
        : {}),
    };
  });

  /** The drawn polyline: dagre's route, with the legs into a frame added. */
  function pointsFor(id: EdgeId, from: string, to: string): Point[] {
    // a subgraph reaching into itself has no container where the two ends are
    // siblings: drop a straight connector down the inner box's centre line
    if (nested.has(id)) {
      const a = rectOf(from);
      const b = rectOf(to);
      const outward = nested.get(id)!;
      const x = outward ? b.x + b.w / 2 : a.x + a.w / 2;
      return outward
        ? [
            { x, y: a.y },
            { x, y: b.y },
          ]
        : [
            { x, y: a.y + a.h },
            { x, y: b.y + b.h },
          ];
    }
    let points = root.paths.get(id)!.points;
    // dagre stopped the line at the frame of the outermost box it crossed;
    // stitch on the stretch each crossed frame routed for it, entering at the
    // border point that aims at it
    const container = containersOf(from).find((c) => containersOf(to).includes(c));
    for (const frame of diveChain(to, container)) {
      const leg = root.legs.get(legKey(id, "to", frame))!;
      const hit = borderCrossing(points.at(-2) ?? points.at(-1)!, leg[0]!, rectOf(frame));
      points = [...points.slice(0, -1), hit ?? points.at(-1)!, ...leg];
    }
    for (const frame of diveChain(from, container)) {
      const leg = root.legs.get(legKey(id, "from", frame))!;
      const hit = borderCrossing(points[1] ?? points[0]!, leg.at(-1)!, rectOf(frame));
      points = [...leg, hit ?? points[0]!, ...points.slice(1)];
    }
    return points;
  }

  function labelPosFor(id: EdgeId, points: readonly Point[]): Point {
    return root.paths.get(id)?.labelPos ?? polylineMidpoint(points);
  }

  let w = root.w;
  let h = root.h;
  for (const box of [...nodes.map((n) => n.rect), ...subgraphs.map((s) => s.rect)]) {
    w = Math.max(w, box.x + box.w);
    h = Math.max(h, box.y + box.h);
  }
  // a self link is a detour dagre draws outside the box it starts from
  for (const e of edges) {
    for (const p of e.points) {
      w = Math.max(w, p.x);
      h = Math.max(h, p.y);
    }
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
