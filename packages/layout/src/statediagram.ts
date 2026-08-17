import dagre from "@dagrejs/dagre";
import type { StateIR, StateId, StateRole, TransitionId } from "@gmermaid/ir";
import type { TextMeasurer } from "./measurer";
import type { Point, Rect } from "./result";

const LABEL_STYLE = { fontSize: 14, fontFamily: "sans-serif" } as const;
const PAD_X = 16;
const PAD_Y = 10;
const MIN_W = 60;
/** [*] start/end pseudo-states render as fixed-size circles. */
const PSEUDO_SIZE = 16;

export interface StateBox {
  readonly id: StateId;
  readonly label: string;
  readonly role: StateRole;
  readonly rect: Rect;
}

export interface TransitionPath {
  readonly id: TransitionId;
  readonly points: readonly Point[];
  readonly label?: string;
  readonly labelPos?: Point;
}

export interface StateLayout {
  readonly kind: "state";
  readonly size: { readonly w: number; readonly h: number };
  readonly states: readonly StateBox[];
  readonly transitions: readonly TransitionPath[];
}

export function layoutStateDiagram(ir: StateIR, measure: TextMeasurer): StateLayout {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: ir.direction ?? "TB", nodesep: 40, ranksep: 50 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const s of ir.states) {
    if (s.role !== "normal") {
      g.setNode(s.id, { width: PSEUDO_SIZE, height: PSEUDO_SIZE });
      continue;
    }
    const m = measure.measure(s.label, LABEL_STYLE);
    g.setNode(s.id, { width: Math.max(MIN_W, m.w + PAD_X * 2), height: m.h + PAD_Y * 2 });
  }
  for (const t of ir.transitions) {
    if (!g.hasNode(t.from) || !g.hasNode(t.to)) {
      throw new Error(`layoutStateDiagram: transition ${t.id} references a missing state`);
    }
    g.setEdge(t.from, t.to, {}, t.id);
  }

  dagre.layout(g);

  const states: StateBox[] = ir.states.map((s) => {
    const pos = g.node(s.id);
    return {
      id: s.id,
      label: s.label,
      role: s.role,
      rect: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2, w: pos.width, h: pos.height },
    };
  });

  const transitions: TransitionPath[] = ir.transitions.map((t) => {
    const e = g.edge(t.from, t.to, t.id);
    const points: Point[] = e.points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y }));
    const mid = points[Math.floor(points.length / 2)]!;
    return {
      id: t.id,
      points,
      ...(t.label !== undefined ? { label: t.label, labelPos: { x: mid.x, y: mid.y - 6 } } : {}),
    };
  });

  const graph = g.graph();
  // dagre reports -Infinity for an empty graph — clamp to a sane empty canvas
  const w = graph.width !== undefined && Number.isFinite(graph.width) ? graph.width : 200;
  const h = graph.height !== undefined && Number.isFinite(graph.height) ? graph.height : 100;
  return { kind: "state", size: { w, h }, states, transitions };
}
