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
  /** `true` when `rect` hits something already added. */
  hits(rect: Rect): boolean;
  /**
   * Take the first candidate that hits nothing, add it and return it. When
   * none is clear, candidates[0] is taken instead (and still added, because
   * the label is drawn there either way) with `free: false`.
   */
  place(candidates: readonly Rect[]): Placement;
}

export function collisionIndex(seed: readonly Rect[] = []): CollisionIndex {
  const rects: Rect[] = [...seed];
  return {
    add(rect) {
      rects.push(rect);
    },
    hits(rect) {
      return rects.some((r) => rectsOverlap(r, rect));
    },
    place(candidates) {
      if (candidates.length === 0) throw new Error("collisionIndex.place: no candidates");
      for (let i = 0; i < candidates.length; i++) {
        const rect = candidates[i]!;
        if (!rects.some((r) => rectsOverlap(r, rect))) {
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
