import dagre from "@dagrejs/dagre";
import type { NoteId, StateIR, StateId, StateRole, TransitionId } from "@gmermaid/ir";
import type { TextMeasurer } from "./measurer";
import type { Point, Rect } from "./result";
import { clipPolylineAtRect } from "./compound";

const LABEL_STYLE = { fontSize: 14, fontFamily: "sans-serif" } as const;
const NOTE_STYLE = { fontSize: 12, fontFamily: "sans-serif" } as const;
const PAD_X = 16;
const PAD_Y = 10;
const MIN_W = 60;
/** [*] start/end pseudo-states render as fixed-size circles. */
const PSEUDO_SIZE = 16;
const CHOICE_SIZE = 28;
/** fork/join bars: long side across the flow direction. */
const BAR_LONG = 56;
const BAR_SHORT = 8;
const NOTE_PAD = 8;
const NOTE_GAP = 14;
// visual breathing room around a composite; the extra top holds the title
const COMP_PAD = 8;
const COMP_TITLE_H = 24;

export interface StateBox {
  readonly id: StateId;
  readonly label: string;
  readonly role: StateRole;
  readonly rect: Rect;
  /** True when the box is a composite frame (drawn behind its children). */
  readonly composite: boolean;
  /** Nesting depth (0 = top level) — outer frames draw first. */
  readonly depth: number;
}

export interface TransitionPath {
  readonly id: TransitionId;
  readonly points: readonly Point[];
  readonly label?: string;
  readonly labelPos?: Point;
}

export interface StateNoteBox {
  readonly id: NoteId;
  readonly rect: Rect;
  readonly text: string;
  readonly anchor: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number };
}

export interface StateLayout {
  readonly kind: "state";
  readonly size: { readonly w: number; readonly h: number };
  readonly states: readonly StateBox[];
  readonly transitions: readonly TransitionPath[];
  readonly notes: readonly StateNoteBox[];
}

export function layoutStateDiagram(ir: StateIR, measure: TextMeasurer): StateLayout {
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: true });
  const horizontal = ir.direction === "LR" || ir.direction === "RL";
  g.setGraph({ rankdir: ir.direction ?? "TB", nodesep: 40, ranksep: 50 });
  g.setDefaultEdgeLabel(() => ({}));

  const childCount = new Map<StateId, number>();
  for (const s of ir.states) if (s.parent !== undefined) childCount.set(s.parent, (childCount.get(s.parent) ?? 0) + 1);
  const isComposite = (id: StateId): boolean => (childCount.get(id) ?? 0) > 0;

  for (const s of ir.states) {
    if (isComposite(s.id)) {
      g.setNode(s.id, {});
      continue;
    }
    if (s.role === "start" || s.role === "end") {
      g.setNode(s.id, { width: PSEUDO_SIZE, height: PSEUDO_SIZE });
    } else if (s.role === "choice") {
      g.setNode(s.id, { width: CHOICE_SIZE, height: CHOICE_SIZE });
    } else if (s.role === "fork" || s.role === "join") {
      g.setNode(s.id, {
        width: horizontal ? BAR_SHORT : BAR_LONG,
        height: horizontal ? BAR_LONG : BAR_SHORT,
      });
    } else {
      const m = measure.measure(s.label, LABEL_STYLE);
      g.setNode(s.id, { width: Math.max(MIN_W, m.w + PAD_X * 2), height: m.h + PAD_Y * 2 });
    }
  }
  for (const s of ir.states) if (s.parent !== undefined) g.setParent(s.id, s.parent);

  // dagre cannot attach edges to clusters: route them to a representative
  // leaf inside, and clip the drawn path at the composite border afterwards
  const representative = (id: StateId): StateId => {
    const start = ir.states.find((s) => s.parent === id && s.role === "start");
    const child = start ?? ir.states.find((s) => s.parent === id);
    if (!child) throw new Error(`layoutStateDiagram: composite ${id} has no members`);
    return isComposite(child.id) ? representative(child.id) : child.id;
  };
  const anchor = (id: StateId): StateId => (isComposite(id) ? representative(id) : id);

  for (const t of ir.transitions) {
    if (!g.hasNode(t.from) || !g.hasNode(t.to)) {
      throw new Error(`layoutStateDiagram: transition ${t.id} references a missing state`);
    }
    g.setEdge(anchor(t.from), anchor(t.to), {}, t.id);
  }

  dagre.layout(g);

  const depth = (s: { parent?: StateId }): number => {
    let d = 0;
    let cur = s.parent;
    while (cur !== undefined) {
      d += 1;
      cur = ir.states.find((x) => x.id === cur)?.parent;
    }
    return d;
  };

  const rectOf = new Map<StateId, Rect>();
  for (const s of ir.states) {
    const pos = g.node(s.id);
    const composite = isComposite(s.id);
    // cluster rects come back tight around members — expand for border + title
    const grow = composite ? COMP_PAD : 0;
    const growTop = composite ? COMP_TITLE_H : 0;
    rectOf.set(s.id, {
      x: pos.x - pos.width / 2 - grow,
      y: pos.y - pos.height / 2 - growTop,
      w: pos.width + grow * 2,
      h: pos.height + growTop + grow,
    });
  }

  const states: StateBox[] = ir.states.map((s) => ({
    id: s.id,
    label: s.label,
    role: s.role,
    rect: rectOf.get(s.id)!,
    composite: isComposite(s.id),
    depth: depth(s),
  }));

  const transitions: TransitionPath[] = ir.transitions.map((t) => {
    const e = g.edge(anchor(t.from), anchor(t.to), t.id);
    let points: Point[] = e.points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y }));
    if (isComposite(t.to)) points = clipPolylineAtRect(points, rectOf.get(t.to)!, "to");
    if (isComposite(t.from)) points = clipPolylineAtRect(points, rectOf.get(t.from)!, "from");
    const mid = points[Math.floor(points.length / 2)]!;
    return {
      id: t.id,
      points,
      ...(t.label !== undefined ? { label: t.label, labelPos: { x: mid.x, y: mid.y - 6 } } : {}),
    };
  });

  // notes sit beside their target, outside the dagre graph
  const notes: StateNoteBox[] = [];
  for (const n of ir.notes) {
    const target = rectOf.get(n.target);
    if (!target) continue;
    const m = measure.measure(n.text, NOTE_STYLE);
    const w = m.w + NOTE_PAD * 2;
    const h = Math.max(26, m.h + NOTE_PAD * 2);
    const y = target.y + target.h / 2 - h / 2;
    const x = n.position === "rightOf" ? target.x + target.w + NOTE_GAP : target.x - NOTE_GAP - w;
    const anchorX = n.position === "rightOf" ? target.x + target.w : target.x;
    notes.push({
      id: n.id,
      rect: { x, y, w, h },
      text: n.text,
      anchor: {
        x1: n.position === "rightOf" ? x : x + w,
        y1: y + h / 2,
        x2: anchorX,
        y2: target.y + target.h / 2,
      },
    });
  }

  const graph = g.graph();
  // dagre reports -Infinity for an empty graph — clamp to a sane empty canvas
  let w = graph.width !== undefined && Number.isFinite(graph.width) ? graph.width : 200;
  let h = graph.height !== undefined && Number.isFinite(graph.height) ? graph.height : 100;
  for (const s of states) {
    w = Math.max(w, s.rect.x + s.rect.w);
    h = Math.max(h, s.rect.y + s.rect.h);
  }
  for (const n of notes) {
    w = Math.max(w, n.rect.x + n.rect.w);
    h = Math.max(h, n.rect.y + n.rect.h);
  }
  return { kind: "state", size: { w, h }, states, transitions, notes };
}
