import { inflate, labelAnchor, type CollisionIndex } from "./collision";
import type { Point, Rect } from "./result";

// Shared geometry for container layouts: a composite/subgraph is laid out in
// a dagre graph of its own and enters its parent as one node, so what is left
// to do by hand is the geometry dagre never sees — self-loop detours, their
// labels, and the leg from a frame border on to an endpoint inside it.

// Self-edge detour geometry (right side of the box). dagre drops self-edges
// entirely, so every diagram kind that allows them synthesizes the path after
// layout; the numbers mirror the class diagram's self-relations so a loop
// looks the same wherever it appears.
const SELF_LOOP_W = 30;
const SELF_LOOP_H = 26;
const SELF_LOOP_STEP = 14;

/** Smallest rect covering them all; a zero-size rect is a bare point. */
export function bboxOf(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    w: Math.max(...rects.map((r) => r.x + r.w)) - x,
    h: Math.max(...rects.map((r) => r.y + r.h)) - y,
  };
}

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
 * Where the line from `outside` to `inside` crosses the border of `rect` — the
 * spot an edge should enter (or leave) a frame at. `null` when the two points
 * are on the same side of the border, which leaves the caller's own point.
 */
export function borderCrossing(outside: Point, inside: Point, rect: Rect): Point | null {
  return segmentRectIntersection(outside, inside, rect);
}
