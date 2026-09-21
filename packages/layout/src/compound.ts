import { inflate, labelAnchor, type CollisionIndex } from "./collision";
import type { Point, Rect } from "./result";

// Shared geometry for compound (cluster) layouts: dagre cannot attach an
// edge to a cluster, so edges targeting a composite/subgraph are routed to a
// REPRESENTATIVE LEAF inside it, then visually cut off at the cluster border.

// Self-edge detour geometry (right side of the box). dagre drops self-edges
// entirely, so every diagram kind that allows them synthesizes the path after
// layout; the numbers mirror the class diagram's self-relations so a loop
// looks the same wherever it appears.
const SELF_LOOP_W = 30;
const SELF_LOOP_H = 26;
const SELF_LOOP_STEP = 14;

/** How far right the `index`-th stacked loop on one box reaches. */
export function SELF_LOOP_REACH(index: number): number {
  return SELF_LOOP_W + index * SELF_LOOP_STEP;
}

/** Rectangular detour off the right side of `rect`; stacked loops on the same
 * box fan outward by `index`. */
export function selfLoopPoints(rect: Rect, index = 0): Point[] {
  const right = rect.x + rect.w;
  const reach = right + SELF_LOOP_REACH(index);
  const cy = rect.y + Math.min(rect.h / 2, SELF_LOOP_H * (index + 1.5));
  return [
    { x: right, y: cy - SELF_LOOP_H / 2 },
    { x: reach, y: cy - SELF_LOOP_H / 2 },
    { x: reach, y: cy + SELF_LOOP_H / 2 },
    { x: right, y: cy + SELF_LOOP_H / 2 },
  ];
}

/** Clear space kept around a self-loop's label: a measured line box is the
 * text's advance, and the glyphs drawn from it want a little more. */
const LABEL_SLACK = 6;
const GAP = 6;

/**
 * Where a self-loop's label goes, given what is already drawn. Candidates run
 * best first — on the detour's axis just past it, then clear above it, then
 * clear below it, then centred over or under the box — and every kind that
 * draws a self-loop offers the same arc, so a label that has to move moves the
 * same way everywhere. A label with nowhere to go keeps the first spot.
 *
 * `reach` and `cy` are the detour's own geometry (see `selfLoopPoints`).
 */
export function placeSelfLoopLabel(
  taken: CollisionIndex,
  box: Rect,
  reach: number,
  cy: number,
  size: { readonly w: number; readonly h: number },
): { labelPos: Point; right: number } {
  const w = size.w + LABEL_SLACK * 2;
  const h = size.h + LABEL_SLACK * 2;
  const right = reach + GAP;
  const boxMid = box.x + box.w / 2 - w / 2;
  const spot = taken.place([
    { x: right, y: cy - h / 2, w, h },
    { x: right, y: cy - SELF_LOOP_H / 2 - GAP - h, w, h },
    { x: right, y: cy + SELF_LOOP_H / 2 + GAP, w, h },
    { x: boxMid, y: box.y - GAP - h, w, h },
    { x: boxMid, y: box.y + box.h + GAP, w, h },
  ]);
  return { labelPos: labelAnchor(inflate(spot.rect, -LABEL_SLACK)), right: spot.rect.x + spot.rect.w };
}

/** First point of segment [a,b] crossing the rect boundary, or null. */
function segmentRectIntersection(a: Point, b: Point, r: Rect): Point | null {
  // walk parametrically from a (outside) to b (inside) — smallest t entering the rect
  const inside = (p: Point) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  if (inside(a) === inside(b)) return null;
  let lo = 0;
  let hi = 1;
  // bisection is robust against axis-aligned degenerate segments
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const p = { x: a.x + (b.x - a.x) * mid, y: a.y + (b.y - a.y) * mid };
    if (inside(p) === inside(a)) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Trim a polyline so it stops at the border of `rect` instead of running to
 * a leaf inside it. `end: "to"` trims the tail (arrow into the cluster),
 * `end: "from"` trims the head (edge leaving the cluster).
 */
export function clipPolylineAtRect(points: readonly Point[], rect: Rect, end: "from" | "to"): Point[] {
  const pts = end === "from" ? points.toReversed() : [...points];
  const inside = (p: Point) => p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
  // walk from the tail toward the head, dropping points inside the rect
  let cut = pts.length;
  while (cut > 0 && inside(pts[cut - 1]!)) cut -= 1;
  if (cut === pts.length || cut === 0) return [...points]; // nothing to trim / fully inside
  const outsideP = pts[cut - 1]!;
  const insideP = pts[cut]!;
  const hit = segmentRectIntersection(outsideP, insideP, rect) ?? insideP;
  const trimmed = [...pts.slice(0, cut), hit];
  return end === "from" ? trimmed.toReversed() : trimmed;
}
