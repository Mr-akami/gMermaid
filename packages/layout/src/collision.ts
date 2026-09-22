import type { Point, Rect } from "./result";

// A label that dagre never saw has to find its own spot. This is the index
// that lets a layout ask "is this rectangle free?" — seeded with everything
// already drawn, then asked for the first candidate position that is clear.
//
// Deliberately a plain array with a linear scan: the diagrams here hold a few
// hundred boxes at most, and a bucketed grid would buy nothing while being
// harder to be sure of. If a diagram ever grows past that, bucket `rects` by
// a cell size — the interface does not change.

/** `true` when the two rectangles share any area (touching edges do not). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * `true` when the segment `a`→`b` passes through the INTERIOR of `rect`.
 *
 * Liang–Barsky clipping: the segment is `a + t·(b−a)` for t in [0,1], and each
 * of the four half-planes trims that interval. A segment that merely grazes an
 * edge, or that ends exactly on the border (which is what an edge touching the
 * node it attaches to looks like), leaves an empty interval and is not a hit.
 *
 * Two boxes overlapping is not the only way a diagram gets unreadable: a
 * polyline drawn across a node, a note or a label hides just as much text, and
 * no pair of rectangles is involved. This is the predicate for that class.
 */
export function segmentHitsRect(a: Point, b: Point, rect: Rect): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const limits: readonly (readonly [number, number])[] = [
    [-dx, a.x - rect.x],
    [dx, rect.x + rect.w - a.x],
    [-dy, a.y - rect.y],
    [dy, rect.y + rect.h - a.y],
  ];
  for (const [p, q] of limits) {
    if (p === 0) {
      if (q < 0) return false; // parallel to this edge and outside it
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
  return t1 - t0 > 1e-6;
}

/** `true` when any segment of the polyline passes through `rect`. */
export function pathHitsRect(points: readonly Point[], rect: Rect): boolean {
  for (let i = 1; i < points.length; i++) {
    if (segmentHitsRect(points[i - 1]!, points[i]!, rect)) return true;
  }
  return false;
}

// Every view draws a free-standing label with `textAnchor="middle"` and the
// BASELINE at labelPos.y, so the ink sits mostly above that point. A layout
// that reasons about where a label lands has to use the same convention, or
// it clears a rectangle the text is not in.
const ASCENT = 0.8;

/** The rect a label drawn at `at` covers. */
export function labelRect(at: Point, size: { readonly w: number; readonly h: number }): Rect {
  return { x: at.x - size.w / 2, y: at.y - size.h * ASCENT, w: size.w, h: size.h };
}

/** Inverse of `labelRect`: the labelPos that draws the label inside `rect`. */
export function labelAnchor(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h * ASCENT };
}

/** `rect` grown by `pad` on every side. */
export function inflate(rect: Rect, pad: number): Rect {
  return { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 };
}

export interface Placement {
  readonly rect: Rect;
  /** Which candidate was taken. */
  readonly index: number;
  /** False when every candidate was occupied and the first one was used
   * anyway — a label with nowhere to go keeps its natural spot. */
  readonly free: boolean;
}

export interface CollisionIndex {
  /** Mark `rect` as occupied. */
  add(rect: Rect): void;
  /**
   * Mark a routed polyline as occupied. An edge is not a box, but landing a
   * note on top of one is just as unreadable, so the index carries both and
   * `hits` answers for either.
   */
  addPath(points: readonly Point[]): void;
  /** `true` when `rect` hits a rect already added, or crosses a path. */
  hits(rect: Rect): boolean;
  /** `true` when the segment `a`→`b` runs through any rect already added.
   * Paths are not consulted: two lines crossing is normal in a diagram. */
  crosses(a: Point, b: Point): boolean;
  /**
   * Take the first candidate that hits nothing, add it and return it. When
   * none is clear, candidates[0] is taken instead (and still added, because
   * the label is drawn there either way) with `free: false`.
   *
   * A caller with a condition of its own — a note also wants its leader line
   * to reach the target without crossing anything — puts its preferred
   * candidate at the head of the list and lets this scan be the fallback.
   */
  place(candidates: readonly Rect[]): Placement;
}

export function collisionIndex(seed: readonly Rect[] = []): CollisionIndex {
  const rects: Rect[] = [...seed];
  const paths: (readonly Point[])[] = [];
  const free = (rect: Rect): boolean =>
    !rects.some((r) => rectsOverlap(r, rect)) && !paths.some((p) => pathHitsRect(p, rect));
  return {
    add(rect) {
      rects.push(rect);
    },
    addPath(points) {
      if (points.length > 1) paths.push(points);
    },
    hits(rect) {
      return !free(rect);
    },
    crosses(a, b) {
      return rects.some((r) => segmentHitsRect(a, b, r));
    },
    place(candidates) {
      if (candidates.length === 0) throw new Error("collisionIndex.place: no candidates");
      for (let i = 0; i < candidates.length; i++) {
        const rect = candidates[i]!;
        if (free(rect)) {
          rects.push(rect);
          return { rect, index: i, free: true };
        }
      }
      const rect = candidates[0]!;
      rects.push(rect);
      return { rect, index: 0, free: false };
    },
  };
}
