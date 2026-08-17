import type { Point, Rect } from "./result";

// Shared geometry for compound (cluster) layouts: dagre cannot attach an
// edge to a cluster, so edges targeting a composite/subgraph are routed to a
// REPRESENTATIVE LEAF inside it, then visually cut off at the cluster border.

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
