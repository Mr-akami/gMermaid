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
import { placeSelfLoopLabel } from "./compound";
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

export function layoutUsecase(ir: UsecaseIR, measure: TextMeasurer): UsecaseLayout {
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: true });
  g.setGraph({ rankdir: ir.direction ?? "TB", nodesep: 45, ranksep: 55 });
  g.setDefaultEdgeLabel(() => ({}));

  const memberCount = new Map<BoundaryId, number>();
  for (const a of ir.actors) if (a.boundary !== undefined) memberCount.set(a.boundary, (memberCount.get(a.boundary) ?? 0) + 1);
  for (const u of ir.usecases) if (u.boundary !== undefined) memberCount.set(u.boundary, (memberCount.get(u.boundary) ?? 0) + 1);
  const emptyFrames = new Set(ir.boundaries.filter((b) => (memberCount.get(b.id) ?? 0) === 0).map((b) => b.id));

  for (const a of ir.actors) {
    const label = textOf(a);
    const labelSize = measure.measure(label, LABEL_FONT);
    const stereoW = a.stereotype !== undefined ? measure.measure(`«${a.stereotype}»`, SMALL_FONT).w : 0;
    g.setNode(a.id, {
      width: Math.max(GLYPH_W, labelSize.w, stereoW) + 8,
      height: GLYPH_H + LABEL_GAP + labelSize.h + (a.stereotype !== undefined ? STEREOTYPE_H : 0),
    });
  }

  for (const u of ir.usecases) {
    const label = textOf(u);
    const labelSize = measure.measure(label, LABEL_FONT);
    const stereoW = u.stereotype !== undefined ? measure.measure(`«${u.stereotype}»`, SMALL_FONT).w : 0;
    const padX = u.shape === "ellipse" ? ELLIPSE_PAD_X : RECT_PAD_X;
    const padY = u.shape === "ellipse" ? ELLIPSE_PAD_Y : RECT_PAD_Y;
    g.setNode(u.id, {
      width: Math.max(MIN_USECASE_W, Math.max(labelSize.w, stereoW) + padX * 2),
      height: Math.max(MIN_USECASE_H, labelSize.h + padY * 2 + (u.stereotype !== undefined ? STEREOTYPE_H : 0)),
    });
  }

  for (const b of ir.boundaries) {
    g.setNode(b.id, emptyFrames.has(b.id) ? { width: EMPTY_FRAME.w, height: EMPTY_FRAME.h } : {});
  }
  for (const a of ir.actors) if (a.boundary !== undefined && !emptyFrames.has(a.boundary)) g.setParent(a.id, a.boundary);
  for (const u of ir.usecases) if (u.boundary !== undefined && !emptyFrames.has(u.boundary)) g.setParent(u.id, u.boundary);

  for (const r of ir.relations) {
    if (!g.hasNode(r.from) || !g.hasNode(r.to)) {
      throw new Error(`layoutUsecase: relation ${r.id} references a missing node`);
    }
    // dagre cannot route self-edges — they are synthesized after layout as a
    // rectangular detour off the node's right side (cf. the class layout)
    if (r.from !== r.to) g.setEdge(r.from, r.to, {}, r.id);
  }

  dagre.layout(g);

  const rectOf = (id: string, frame: boolean): Rect => {
    const pos = g.node(id);
    // cluster rects come back tight around members — expand for border + title
    const grow = frame ? FRAME_PAD : 0;
    const growTop = frame ? FRAME_TITLE_H : 0;
    return {
      x: pos.x - pos.width / 2 - grow,
      y: pos.y - pos.height / 2 - growTop,
      w: pos.width + grow * 2,
      h: pos.height + growTop + grow,
    };
  };

  const actors: ActorGlyph[] = ir.actors.map((a) => {
    const rect = rectOf(a.id, false);
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
    rect: rectOf(u.id, false),
    label: textOf(u),
    shape: u.shape,
    business: u.business === true,
    ...(u.stereotype !== undefined ? { stereotype: u.stereotype } : {}),
  }));

  const boundaries: UsecaseBoundaryFrame[] = ir.boundaries.map((b) => ({
    id: b.id,
    rect: rectOf(b.id, !emptyFrames.has(b.id)),
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
      const e = g.edge(r.from, r.to, r.id);
      points = e.points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y }));
      const mid = points[Math.floor(points.length / 2)]!;
      labelPos = { x: mid.x, y: mid.y - 6 };
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

  const graph = g.graph();
  // dagre reports -Infinity for an empty graph — clamp to a sane empty canvas
  let w = graph.width !== undefined && Number.isFinite(graph.width) ? graph.width : 200;
  let h = graph.height !== undefined && Number.isFinite(graph.height) ? graph.height : 100;
  w = Math.max(w, selfMaxRight);
  for (const b of boundaries) {
    w = Math.max(w, b.rect.x + b.rect.w);
    h = Math.max(h, b.rect.y + b.rect.h);
  }
  for (const n of notes) {
    w = Math.max(w, n.rect.x + n.rect.w);
    h = Math.max(h, n.rect.y + n.rect.h);
  }
  return { kind: "usecase", size: { w, h }, actors, usecases, boundaries, edges, notes };
}
