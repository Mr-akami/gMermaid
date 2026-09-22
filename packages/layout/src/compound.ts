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

/** How far right the `index`-th stacked loop on one box reaches. Callers
 * that need it after the fact read it off the points instead. */
function SELF_LOOP_REACH(index: number): number {
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


// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/** Default gap between a note and whatever it sits beside. */
const NOTE_GAP = 14;
/** How many steps outward the search may take before giving up. */
const NOTE_RINGS = 3;
/** How far along a side a note may slide, in gaps. */
const NOTE_SLIDES = 6;

/** Where a note ended up, and the leader line that says what it annotates. */
export interface NotePlacement {
  readonly rect: Rect;
  readonly anchor: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number };
  /** False when nothing was clear and the natural spot was kept anyway. */
  readonly free: boolean;
}

export type NoteSide = "right" | "left" | "below" | "above";

/** Clip the ray from `from` towards `to` at `rect`'s border, so a leader line
 * starts on the note's edge and stops on the target's edge. */
function clipToBorder(from: Point, to: Point, rect: Rect): Point {
  return borderCrossing(to, from, rect) ?? from;
}

/**
 * Where a note box goes, given everything already drawn.
 *
 * Legibility comes first. A note that sits exactly where `note right of X`
 * says, but covers the state next door, hides more than a note a step away
 * with a leader line pointing back at its target — so the search is allowed to
 * wander. The IR still says `rightOf`; only the drawing moves, and a round
 * trip through the codegen emits the same text it read.
 *
 * The candidate arc is ordered by how much work it costs the reader, not by
 * pixels:
 *
 *   1. the side the text asked for — centred first, then sliding along that
 *      side in one-gap steps, nearest offset first, so the note slots into a
 *      gap between neighbours rather than leaping past them;
 *   2. the opposite side, the same way — still beside the target;
 *   3. below, then above: further for the eye to travel than "beside", which
 *      is the shape a reader expects a note to have;
 *   4. the same four sides one, two, three steps further out, a step being the
 *      note's own extent plus the gap;
 *   5. the four diagonals last — a corner reads as "near", but not "beside".
 *
 * Nothing past ring 3 is offered. Beyond that the note is too far from its
 * target to be worth the canvas, and keeping the natural spot — overlap and
 * all — is the better of two bad outcomes, because the reader can at least
 * tell what it belongs to. Candidates in negative space are skipped outright:
 * the diagram's origin is (0,0) and the view does not scroll to meet a note
 * placed off the top-left.
 *
 * Two tiers, in this order:
 *
 *   - the first candidate whose box is clear of every box AND every routed
 *     edge, and whose LEADER reaches the target crossing nothing;
 *   - failing that, the first whose box alone is clear. A thin dashed leader
 *     passing behind a box costs a reader far less than an opaque note laid
 *     over one, so a blocked leader is a preference, not a veto.
 */
export function placeNote(
  taken: CollisionIndex,
  target: Rect,
  size: { readonly w: number; readonly h: number },
  prefer: NoteSide,
  gap: number = NOTE_GAP,
): NotePlacement {
  const { w, h } = size;
  const midX = target.x + target.w / 2 - w / 2;
  const midY = target.y + target.h / 2 - h / 2;

  /** `ring` steps out from the target on `side`, `slide` gaps along it. */
  const at = (side: NoteSide, ring: number, slide: number): Rect => {
    const outX = gap + ring * (w + gap);
    const outY = gap + ring * (h + gap);
    switch (side) {
      case "right":
        return { x: target.x + target.w + outX, y: midY + slide * gap, w, h };
      case "left":
        return { x: target.x - outX - w, y: midY + slide * gap, w, h };
      case "below":
        return { x: midX + slide * gap, y: target.y + target.h + outY, w, h };
      case "above":
        return { x: midX + slide * gap, y: target.y - outY - h, w, h };
    }
  };

  const opposite: Record<NoteSide, NoteSide> = { right: "left", left: "right", below: "above", above: "below" };
  const across: readonly NoteSide[] = prefer === "right" || prefer === "left" ? ["below", "above"] : ["right", "left"];
  const sides: readonly NoteSide[] = [prefer, opposite[prefer], ...across];
  // nearest offset first: 0, -1, +1, -2, +2, …
  const slides = [0, ...Array.from({ length: NOTE_SLIDES }, (_, i) => [-(i + 1), i + 1]).flat()];

  const candidates: Rect[] = [];
  for (let ring = 0; ring <= NOTE_RINGS; ring++) {
    for (const side of sides) for (const slide of slides) candidates.push(at(side, ring, slide));
  }
  for (let ring = 0; ring < NOTE_RINGS; ring++) {
    const dx = gap + ring * (w + gap);
    const dy = gap + ring * (h + gap);
    candidates.push(
      { x: target.x + target.w + dx, y: target.y + target.h + dy, w, h },
      { x: target.x - dx - w, y: target.y + target.h + dy, w, h },
      { x: target.x + target.w + dx, y: target.y - dy - h, w, h },
      { x: target.x - dx - w, y: target.y - dy - h, w, h },
    );
  }
  const onCanvas = candidates.filter((r) => r.x >= 0 && r.y >= 0);
  // the natural spot is the fallback, so it has to survive even off-canvas
  const arc = onCanvas.length > 0 ? onCanvas : [candidates[0]!];

  const leader = (rect: Rect) => {
    const nc = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    const tc = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
    return { start: clipToBorder(nc, tc, rect), end: clipToBorder(tc, nc, target) };
  };
  /** The leader stops ON the note and the target, so pull both ends a hair
   * inward before asking whether it crosses anything — otherwise the two
   * boxes it connects count as obstacles. */
  const leaderClear = (rect: Rect): boolean => {
    const { start, end } = leader(rect);
    const len = Math.hypot(end.x - start.x, end.y - start.y);
    if (len < 1) return false; // a leader too short to see is not a leader
    const ux = ((end.x - start.x) / len) * 0.5;
    const uy = ((end.y - start.y) / len) * 0.5;
    return !taken.crosses({ x: start.x + ux, y: start.y + uy }, { x: end.x - ux, y: end.y - uy });
  };

  const best = arc.find((r) => !taken.hits(r) && leaderClear(r));
  const spot = taken.place(best !== undefined ? [best, ...arc] : arc);
  const { start, end } = leader(spot.rect);
  return { rect: spot.rect, anchor: { x1: start.x, y1: start.y, x2: end.x, y2: end.y }, free: spot.free };
}
