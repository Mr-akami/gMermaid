import { rectsOverlap } from "./collision";
import type { ClassLayout } from "./classdiagram";
import type { GanttLayout } from "./gantt";
import type { JourneyLayout } from "./journey";
import type { MindmapLayout } from "./mindmap";
import type { RequirementLayout } from "./requirement";
import type { FlowchartLayout, Point, Rect } from "./result";
import type { SequenceLayout } from "./sequenceResult";
import type { StateLayout } from "./statediagram";
import type { TimelineLayout } from "./timeline";
import type { UsecaseLayout } from "./usecase";

// Rubber-band selection. The band is a rectangle in DIAGRAM space, and the
// answer is "every element it touches" — which the DOM cannot give us (an
// SVG hit test only answers for a point), so it lives here, beside the
// geometry, exactly as ADR 0001 says: clicks go to the DOM, marquee and
// alignment go to the layout.
//
// One `marqueeHits` per diagram kind would be ten copies of the same two
// questions ("does the band touch this box?", "does it cross this path?"),
// so instead each layout is flattened to the boxes and polylines it draws
// and the two questions are asked once.

/** Every layout the editors produce — the marquee is the first thing that
 * has to answer for all ten kinds at once. */
export type DiagramLayout =
  | FlowchartLayout
  | SequenceLayout
  | ClassLayout
  | StateLayout
  | TimelineLayout
  | JourneyLayout
  | RequirementLayout
  | UsecaseLayout
  | MindmapLayout
  | GanttLayout;

/** The rectangle spanned by two corners, whichever way the drag went. */
export function bandRect(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    w: Math.abs(to.x - from.x),
    h: Math.abs(to.y - from.y),
  };
}

function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Liang–Barsky: does the segment `a`→`b` share any point with `r`? */
function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // p/q pairs for the four half-planes (left, right, top, bottom)
  const edges: readonly (readonly [number, number])[] = [
    [-dx, a.x - r.x],
    [dx, r.x + r.w - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.h - a.y],
  ];
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false; // parallel and outside
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

/** Does the band touch the polyline? A single-point "path" is a point test. */
export function pathHitsBand(points: readonly Point[], band: Rect): boolean {
  if (points.length === 0) return false;
  if (points.length === 1) return pointInRect(points[0]!, band);
  for (let i = 0; i < points.length - 1; i++) {
    if (segmentHitsRect(points[i]!, points[i + 1]!, band)) return true;
  }
  return false;
}

/** A zero-area band (a drag that never moved) touches nothing — otherwise a
 * stray click would select whatever happened to sit under the pointer. */
function empty(band: Rect): boolean {
  return band.w < 1 && band.h < 1;
}

interface Hits {
  box(id: string, rect: Rect): void;
  path(id: string, points: readonly Point[]): void;
}

function collector(band: Rect): { hits: Hits; ids: string[] } {
  const ids: string[] = [];
  const add = (id: string) => {
    if (!ids.includes(id)) ids.push(id);
  };
  return {
    ids,
    hits: {
      box: (id, rect) => {
        if (rectsOverlap(band, rect)) add(id);
      },
      path: (id, points) => {
        if (pathHitsBand(points, band)) add(id);
      },
    },
  };
}

/**
 * Ids of every element the band touches, in draw order.
 *
 * "Touches" is deliberately generous (any shared area, any crossed segment)
 * rather than "encloses": a band drawn across a diagram is how a user says
 * "these", and having to lasso an edge's full polyline would make edges
 * practically unselectable.
 */
export function marqueeHits(layout: DiagramLayout, band: Rect): readonly string[] {
  if (empty(band)) return [];
  const { hits, ids } = collector(band);
  switch (layout.kind) {
    case "flowchart":
      for (const s of layout.subgraphs) hits.box(s.id, s.rect);
      for (const e of layout.edges) hits.path(e.id, e.points);
      for (const n of layout.nodes) hits.box(n.id, n.rect);
      break;
    case "sequence":
      for (const l of layout.lifelines) hits.box(l.id, l.headRect);
      for (const f of layout.fragments) hits.box(f.id, f.rect);
      for (const m of layout.messages) {
        hits.path(m.id, [{ x: m.fromX, y: m.y }, { x: m.toX, y: m.y }]);
      }
      for (const n of layout.notes) hits.box(n.id, n.rect);
      break;
    case "class":
      for (const n of layout.namespaces) hits.box(n.id, n.rect);
      for (const r of layout.relations) hits.path(r.id, r.points);
      for (const c of layout.classes) hits.box(c.id, c.rect);
      for (const n of layout.notes) hits.box(n.id, n.rect);
      break;
    case "state":
      for (const s of layout.states) hits.box(s.id, s.rect);
      for (const t of layout.transitions) hits.path(t.id, t.points);
      for (const n of layout.notes) hits.box(n.id, n.rect);
      break;
    case "timeline":
      for (const s of layout.sections) hits.box(s.id, s.rect);
      for (const p of layout.periods) hits.box(p.id, p.rect);
      for (const e of layout.events) hits.box(e.id, e.rect);
      break;
    case "journey":
      for (const s of layout.sections) hits.box(s.id, s.rect);
      for (const t of layout.tasks) hits.box(t.id, t.rect);
      break;
    case "requirement":
      for (const e of layout.edges) hits.path(e.id, e.points);
      for (const b of layout.boxes) hits.box(b.id, b.rect);
      break;
    case "usecase":
      for (const b of layout.boundaries) hits.box(b.id, b.rect);
      for (const e of layout.edges) hits.path(e.id, e.points);
      for (const u of layout.usecases) hits.box(u.id, u.rect);
      for (const a of layout.actors) hits.box(a.id, a.rect);
      for (const n of layout.notes) hits.box(n.id, n.rect);
      break;
    case "mindmap":
      for (const n of layout.nodes) hits.box(n.id, n.rect);
      break;
    case "gantt":
      for (const s of layout.sections) hits.box(s.id, s.rect);
      for (const b of layout.bars) {
        hits.box(b.id, b.rect);
        hits.box(b.id, b.labelRect);
      }
      break;
  }
  return ids;
}
