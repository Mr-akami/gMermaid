import dagre from "@dagrejs/dagre";
import type {
  ActorId,
  ActorVariant,
  BoundaryId,
  BoundaryType,
  NoteId,
  UseCaseId,
  UseCaseShape,
  UsecaseHead,
  UsecaseIR,
  UsecaseNodeId,
  UsecaseRelationId,
} from "@gmermaid/ir";
import { collisionIndex } from "./collision";
import { bboxOf, borderCrossing, placeSelfLoopLabel } from "./compound";
import { edgeLabelSize } from "./measurer";
import type { TextMeasurer } from "./measurer";
import type { Point, Rect } from "./result";

const LABEL_FONT = { fontSize: 13, fontFamily: "sans-serif" } as const;
const SMALL_FONT = { fontSize: 11, fontFamily: "sans-serif" } as const;
/** The stick figure itself; the label hangs underneath it. */
const GLYPH_W = 40;
const GLYPH_H = 52;
const LABEL_GAP = 4;
const STEREOTYPE_H = 15;
const ELLIPSE_PAD_X = 26;
const ELLIPSE_PAD_Y = 16;
const RECT_PAD_X = 14;
const RECT_PAD_Y = 12;
const MIN_USECASE_W = 90;
const MIN_USECASE_H = 44;
/** Breathing room around a boundary frame; the extra top holds the title. */
const FRAME_PAD = 10;
const FRAME_TITLE_H = 26;
/** An empty boundary is not a dagre cluster — it becomes a plain box. */
const EMPTY_FRAME = { w: 140, h: 70 };
const NOTE_PAD = 8;
const NOTE_GAP = 16;
// self-relation detour geometry (right side of the node), as in the class layout
const SELF_W = 30;
const SELF_H = 26;
const SELF_STEP = 14;

export interface ActorGlyph {
  readonly id: ActorId;
  readonly rect: Rect;
  readonly label: string;
  readonly variant: ActorVariant;
  readonly business: boolean;
  readonly stereotype?: string;
  /** y where the stick figure ends and the label block starts. */
  readonly glyphBottom: number;
}

export interface UseCaseBox {
  readonly id: UseCaseId;
  readonly rect: Rect;
  readonly label: string;
  readonly shape: UseCaseShape;
  readonly business: boolean;
  readonly stereotype?: string;
}

export interface UsecaseBoundaryFrame {
  readonly id: BoundaryId;
  readonly rect: Rect;
  readonly label: string;
  readonly type: BoundaryType;
}

export interface UsecaseEdgePath {
  readonly id: UsecaseRelationId;
  readonly points: readonly Point[];
  readonly line: "solid" | "dashed";
  readonly headFrom: UsecaseHead;
  readonly headTo: UsecaseHead;
  readonly label?: string;
  readonly labelPos?: Point;
  readonly kind?: "include" | "extend";
}

export interface UsecaseNoteBox {
  readonly id: NoteId;
  readonly rect: Rect;
  readonly text: string;
  readonly anchor: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number };
}

export interface UsecaseLayout {
  readonly kind: "usecase";
  readonly size: { readonly w: number; readonly h: number };
  readonly actors: readonly ActorGlyph[];
  readonly usecases: readonly UseCaseBox[];
  readonly boundaries: readonly UsecaseBoundaryFrame[];
  readonly edges: readonly UsecaseEdgePath[];
  readonly notes: readonly UsecaseNoteBox[];
}

/** What is drawn for an element: its label, or its identifier when bare. */
const textOf = (x: { name: string; label?: string }): string => x.label ?? x.name;

/** include / extend name themselves on the line, as mermaid draws them. */
const drawnLabel = (r: { kind?: "include" | "extend"; label?: string }): string | undefined =>
  r.kind !== undefined ? `«${r.kind}»` : r.label;

/** A routed relation in the coordinates of the container that produced it. */
interface Route {
  readonly points: Point[];
  readonly labelPos: Point;
}

/**
 * The stretch of a relation inside the boundary it crosses. dagre only sees
 * one container at a time, so a relation reaching into a frame is handed to
 * that frame's own graph too, attached to a near-zero PROXY standing in for
 * whatever is outside — otherwise the line would cut straight through the
 * elements between the border and its endpoint.
 */
interface Leg {
  readonly id: UsecaseRelationId;
  readonly end: "from" | "to";
  readonly target: string;
}

/** The proxy that stands in for the far side of a crossing edge. Not zero:
 * dagre refuses to intersect a rectangle with no area. */
const PROXY_SIZE = { width: 1, height: 1 } as const;

const proxyId = (id: UsecaseRelationId, end: "from" | "to"): string => `\u0000${id}|${end}`;

export function layoutUsecase(ir: UsecaseIR, measure: TextMeasurer): UsecaseLayout {
  const memberCount = new Map<BoundaryId, number>();
  for (const a of ir.actors) if (a.boundary !== undefined) memberCount.set(a.boundary, (memberCount.get(a.boundary) ?? 0) + 1);
  for (const u of ir.usecases) if (u.boundary !== undefined) memberCount.set(u.boundary, (memberCount.get(u.boundary) ?? 0) + 1);
  const emptyFrames = new Set(ir.boundaries.filter((b) => (memberCount.get(b.id) ?? 0) === 0).map((b) => b.id));

  const size = new Map<string, { width: number; height: number }>();
  for (const a of ir.actors) {
    const labelSize = measure.measure(textOf(a), LABEL_FONT);
    const stereoW = a.stereotype !== undefined ? measure.measure(`«${a.stereotype}»`, SMALL_FONT).w : 0;
    size.set(a.id, {
      width: Math.max(GLYPH_W, labelSize.w, stereoW) + 8,
      height: GLYPH_H + LABEL_GAP + labelSize.h + (a.stereotype !== undefined ? STEREOTYPE_H : 0),
    });
  }

  for (const u of ir.usecases) {
    const labelSize = measure.measure(textOf(u), LABEL_FONT);
    const stereoW = u.stereotype !== undefined ? measure.measure(`«${u.stereotype}»`, SMALL_FONT).w : 0;
    const padX = u.shape === "ellipse" ? ELLIPSE_PAD_X : RECT_PAD_X;
    const padY = u.shape === "ellipse" ? ELLIPSE_PAD_Y : RECT_PAD_Y;
    size.set(u.id, {
      width: Math.max(MIN_USECASE_W, Math.max(labelSize.w, stereoW) + padX * 2),
      height: Math.max(MIN_USECASE_H, labelSize.h + padY * 2 + (u.stereotype !== undefined ? STEREOTYPE_H : 0)),
    });
  }

  const boundaryOf = new Map<string, BoundaryId | undefined>([
    ...ir.actors.map((a): [string, BoundaryId | undefined] => [a.id, a.boundary]),
    ...ir.usecases.map((u): [string, BoundaryId | undefined] => [u.id, u.boundary]),
  ]);
  const membersOf = (b: BoundaryId | undefined): string[] =>
    [...size.keys()].filter((id) => boundaryOf.get(id) === b);

  for (const r of ir.relations) {
    for (const end of [r.from, r.to] as const) {
      if (!size.has(end)) throw new Error(`layoutUsecase: relation ${r.id} references a missing node`);
    }
  }

  // Which graph a relation is routed in: the boundary that holds both ends, or
  // the diagram. One that crosses a frame is routed to the frame — a boundary
  // is a plain node in the outer graph, never a dagre cluster, because dagre's
  // compound layout adds border ranks that stretch every rank gap in the
  // diagram (measured: 55px between two nodes became 165px with one frame).
  interface Placed {
    readonly id: UsecaseRelationId;
    readonly from: string;
    readonly to: string;
    /** what is drawn on the line — dagre keeps a gap clear for it */
    readonly label?: string;
  }
  const relationsIn = new Map<string, Placed[]>();
  const legsIn = new Map<BoundaryId, Leg[]>();
  const ROOT = "";
  for (const r of ir.relations) {
    // dagre cannot route self-edges — they are synthesized after layout as a
    // rectangular detour off the node's right side (cf. the class layout)
    if (r.from === r.to) continue;
    const bf = boundaryOf.get(r.from);
    const bt = boundaryOf.get(r.to);
    const container = bf === bt ? bf : undefined;
    const key = container ?? ROOT;
    const lift = (id: string) => (container === undefined ? (boundaryOf.get(id) ?? id) : id);
    const drawn = drawnLabel(r);
    relationsIn.set(key, [
      ...(relationsIn.get(key) ?? []),
      { id: r.id, from: lift(r.from), to: lift(r.to), ...(drawn !== undefined ? { label: drawn } : {}) },
    ]);
    if (container !== undefined) continue;
    for (const [end, node] of [
      ["from", r.from],
      ["to", r.to],
    ] as const) {
      const frame = boundaryOf.get(node);
      if (frame === undefined) continue;
      legsIn.set(frame, [...(legsIn.get(frame) ?? []), { id: r.id, end, target: node }]);
    }
  }

  interface SubLayout {
    readonly w: number;
    readonly h: number;
    readonly rects: Map<string, Rect>;
    readonly paths: Map<UsecaseRelationId, Route>;
    /** by `${id}|${end}` — the piece of a crossing relation routed in here */
    readonly legs: Map<string, Point[]>;
  }

  /** Everything directly inside `boundary` (undefined = the diagram) in a
   * dagre graph of its own. A boundary enters the diagram's graph as a single
   * node the size of its finished contents. */
  const layoutContainer = (boundary: BoundaryId | undefined, frames: Map<BoundaryId, SubLayout>): SubLayout => {
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setGraph({ rankdir: ir.direction ?? "TB", nodesep: 45, ranksep: 55 });
    g.setDefaultEdgeLabel(() => ({}));

    const kids = membersOf(boundary);
    for (const id of kids) g.setNode(id, size.get(id)!);
    if (boundary === undefined) {
      for (const b of ir.boundaries) {
        const sub = frames.get(b.id);
        g.setNode(b.id, sub ? { width: sub.w, height: sub.h } : { width: EMPTY_FRAME.w, height: EMPTY_FRAME.h });
      }
    }

    const relations = relationsIn.get(boundary ?? ROOT) ?? [];
    // telling dagre the label's measured size is what keeps a long label off
    // the nodes its relation runs between (cf. the flowchart layout)
    for (const r of relations) g.setEdge(r.from, r.to, edgeLabelSize(r.label, measure, SMALL_FONT), r.id);

    // a relation crossing this frame is routed inside it too, from a proxy
    // that stands for everything outside
    const legs = boundary !== undefined ? (legsIn.get(boundary) ?? []) : [];
    for (const leg of legs) {
      const proxy = proxyId(leg.id, leg.end);
      g.setNode(proxy, PROXY_SIZE);
      if (leg.end === "to") g.setEdge(proxy, leg.target, {}, `${leg.id}|leg`);
      else g.setEdge(leg.target, proxy, {}, `${leg.id}|leg`);
    }

    dagre.layout(g);

    const proxies = new Set(legs.map((leg) => proxyId(leg.id, leg.end)));
    const local = new Map<string, Rect>();
    for (const id of g.nodes()) {
      if (proxies.has(id)) continue;
      const p = g.node(id);
      local.set(id, { x: p.x - p.width / 2, y: p.y - p.height / 2, w: p.width, h: p.height });
    }
    const legRoutes = new Map<string, Point[]>();
    for (const leg of legs) {
      const proxy = proxyId(leg.id, leg.end);
      const e = leg.end === "to" ? g.edge(proxy, leg.target, `${leg.id}|leg`) : g.edge(leg.target, proxy, `${leg.id}|leg`);
      legRoutes.set(`${leg.id}|${leg.end}`, e.points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y })));
    }
    const routes = new Map<UsecaseRelationId, Route>();
    for (const r of relations) {
      const e = g.edge(r.from, r.to, r.id);
      const points = e.points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y }));
      // dagre places a sized label itself; without one, sit just above the line
      const mid = points[Math.floor(points.length / 2)]!;
      const labelPos = typeof e.x === "number" && typeof e.y === "number" ? { x: e.x, y: e.y } : { x: mid.x, y: mid.y - 6 };
      routes.set(r.id, { points, labelPos });
    }

    // the frame wraps its members, with the title band left clear above them
    const framed = boundary !== undefined;
    const extent = [
      ...local.values(),
      ...[...routes.values()].flatMap((r) => [...r.points, r.labelPos]).map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })),
      ...[...legRoutes.values()].flat().map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })),
    ];
    const inner = bboxOf(extent);
    const offX = framed ? FRAME_PAD - inner.x : 0;
    const offY = framed ? FRAME_TITLE_H - inner.y : 0;
    const graph = g.graph();
    const rects = new Map<string, Rect>();
    for (const [id, r] of local) rects.set(id, { ...r, x: r.x + offX, y: r.y + offY });
    const paths = new Map<UsecaseRelationId, Route>();
    for (const [id, r] of routes) {
      paths.set(id, {
        points: r.points.map((p) => ({ x: p.x + offX, y: p.y + offY })),
        labelPos: { x: r.labelPos.x + offX, y: r.labelPos.y + offY },
      });
    }

    const legPaths = new Map<string, Point[]>();
    for (const [key, pts] of legRoutes) legPaths.set(key, pts.map((p) => ({ x: p.x + offX, y: p.y + offY })));

    // dagre reports -Infinity for an empty graph — clamp to a sane empty canvas
    return {
      w: framed ? inner.w + FRAME_PAD * 2 : Number.isFinite(graph.width) ? graph.width! : 200,
      h: framed ? inner.h + FRAME_TITLE_H + FRAME_PAD : Number.isFinite(graph.height) ? graph.height! : 100,
      rects,
      paths,
      legs: legPaths,
    };
  };

  const frames = new Map<BoundaryId, SubLayout>();
  for (const b of ir.boundaries) if (!emptyFrames.has(b.id)) frames.set(b.id, layoutContainer(b.id, frames));
  const root = layoutContainer(undefined, frames);

  const rectOf = (id: string): Rect => {
    const own = root.rects.get(id);
    if (own !== undefined) return own;
    // a member: its coordinates are local to the frame it sits in
    const frame = root.rects.get(boundaryOf.get(id)!)!;
    const inside = frames.get(boundaryOf.get(id)!)!.rects.get(id)!;
    return { ...inside, x: inside.x + frame.x, y: inside.y + frame.y };
  };
  /** The drawn polyline and where its label goes. The label stays where dagre
   * kept a gap for it, never on the leg that dives into a frame. */
  const pathOf = (id: UsecaseRelationId, from: string, to: string): Route => {
    const own = root.paths.get(id);
    if (own === undefined) {
      const frame = root.rects.get(boundaryOf.get(from)!)!;
      const inside = frames.get(boundaryOf.get(from)!)!.paths.get(id)!;
      const shift = (p: Point) => ({ x: p.x + frame.x, y: p.y + frame.y });
      return { points: inside.points.map(shift), labelPos: shift(inside.labelPos) };
    }
    // dagre stopped the line at the frame: stitch on the stretch the frame
    // routed for it, entering at the border point that aims at it
    let points = own.points;
    const legOf = (end: "from" | "to", node: string): Point[] | undefined => {
      const frame = boundaryOf.get(node);
      if (frame === undefined) return undefined;
      const box = root.rects.get(frame)!;
      return frames.get(frame)!.legs.get(`${id}|${end}`)!.map((p) => ({ x: p.x + box.x, y: p.y + box.y }));
    };
    const into = legOf("to", to);
    if (into !== undefined) {
      const hit = borderCrossing(points.at(-2) ?? points.at(-1)!, into[0]!, rectOf(boundaryOf.get(to)!));
      points = [...points.slice(0, -1), hit ?? points.at(-1)!, ...into];
    }
    const outOf = legOf("from", from);
    if (outOf !== undefined) {
      const hit = borderCrossing(points[1] ?? points[0]!, outOf.at(-1)!, rectOf(boundaryOf.get(from)!));
      points = [...outOf, hit ?? points[0]!, ...points.slice(1)];
    }
    return { points, labelPos: own.labelPos };
  };

  const actors: ActorGlyph[] = ir.actors.map((a) => {
    const rect = rectOf(a.id);
    return {
      id: a.id,
      rect,
      label: textOf(a),
      variant: a.variant,
      business: a.business === true,
      ...(a.stereotype !== undefined ? { stereotype: a.stereotype } : {}),
      glyphBottom: rect.y + GLYPH_H,
    };
  });

  const usecases: UseCaseBox[] = ir.usecases.map((u) => ({
    id: u.id,
    rect: rectOf(u.id),
    label: textOf(u),
    shape: u.shape,
    business: u.business === true,
    ...(u.stereotype !== undefined ? { stereotype: u.stereotype } : {}),
  }));

  const boundaries: UsecaseBoundaryFrame[] = ir.boundaries.map((b) => ({
    id: b.id,
    rect: rectOf(b.id),
    label: textOf(b),
    type: b.type,
  }));

  const rectById = new Map<string, Rect>([
    ...actors.map((a): [string, Rect] => [a.id, a.rect]),
    ...usecases.map((u): [string, Rect] => [u.id, u.rect]),
  ]);
  // notes sit beside their target, outside the dagre graph (cf. state notes)
  const noteCount = new Map<UsecaseNodeId, number>();
  const notes: UsecaseNoteBox[] = [];
  for (const n of ir.notes) {
    const target = rectById.get(n.target);
    if (target === undefined) continue;
    const k = noteCount.get(n.target) ?? 0;
    noteCount.set(n.target, k + 1);
    const m = measure.measure(n.text, SMALL_FONT);
    const w = m.w + NOTE_PAD * 2;
    const h = Math.max(26, m.h + NOTE_PAD * 2);
    const x = target.x + target.w + NOTE_GAP;
    const y = target.y + target.h / 2 - h / 2 + k * (h + 8);
    notes.push({
      id: n.id,
      rect: { x, y, w, h },
      text: n.text,
      anchor: { x1: x, y1: y + h / 2, x2: target.x + target.w, y2: target.y + target.h / 2 },
    });
  }

  const selfCount = new Map<UsecaseNodeId, number>();
  let selfMaxRight = 0;
  // dagre reserved room for the labels on the edges it routed; a self-edge is
  // drawn afterwards, and its right side is where the notes live too.
  const taken = collisionIndex([
    ...actors.map((a) => a.rect),
    ...usecases.map((u) => u.rect),
    ...notes.map((n) => n.rect),
  ]);

  const edges: UsecaseEdgePath[] = ir.relations.map((r) => {
    let points: Point[];
    let labelPos: Point;
    if (r.from === r.to) {
      const rect = rectById.get(r.from)!;
      const k = selfCount.get(r.from) ?? 0;
      selfCount.set(r.from, k + 1);
      const right = rect.x + rect.w;
      const reach = right + SELF_W + k * SELF_STEP;
      const cy = rect.y + Math.min(rect.h / 2, SELF_H * (k + 1.5));
      points = [
        { x: right, y: cy - SELF_H / 2 },
        { x: reach, y: cy - SELF_H / 2 },
        { x: reach, y: cy + SELF_H / 2 },
        { x: right, y: cy + SELF_H / 2 },
      ];
      // include/extend rename the edge, so measure what is actually drawn
      const drawn = r.kind !== undefined ? `«${r.kind}»` : r.label;
      if (drawn === undefined) {
        labelPos = { x: reach + 6, y: cy };
        selfMaxRight = Math.max(selfMaxRight, reach);
      } else {
        const spot = placeSelfLoopLabel(taken, rect, reach, cy, measure.measure(drawn, SMALL_FONT));
        labelPos = spot.labelPos;
        selfMaxRight = Math.max(selfMaxRight, spot.right + 6);
      }
    } else {
      const route = pathOf(r.id, r.from, r.to);
      points = route.points;
      labelPos = route.labelPos;
    }
    // include / extend name themselves on the edge, as mermaid draws them
    const text = r.kind !== undefined ? `«${r.kind}»` : r.label;
    return {
      id: r.id,
      points,
      line: r.line,
      headFrom: r.headFrom,
      headTo: r.headTo,
      ...(text !== undefined ? { label: text, labelPos } : {}),
      ...(r.kind !== undefined ? { kind: r.kind } : {}),
    };
  });

  let w = Math.max(root.w, selfMaxRight);
  let h = root.h;
  for (const rect of [...boundaries.map((b) => b.rect), ...actors.map((a) => a.rect), ...usecases.map((u) => u.rect)]) {
    w = Math.max(w, rect.x + rect.w);
    h = Math.max(h, rect.y + rect.h);
  }
  for (const n of notes) {
    w = Math.max(w, n.rect.x + n.rect.w);
    h = Math.max(h, n.rect.y + n.rect.h);
  }
  return { kind: "usecase", size: { w, h }, actors, usecases, boundaries, edges, notes };
}
