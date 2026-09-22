import { describe, expect, it } from "vitest";
import {
  collisionIndex,
  inflate,
  labelAnchor,
  labelRect,
  pathHitsRect,
  rectsOverlap,
  segmentHitsRect,
} from "./collision";
import { placeNote } from "./compound";

const r = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("collisionIndex", () => {
  it("counts shared area, but not a shared edge", () => {
    expect(rectsOverlap(r(0, 0, 10, 10), r(5, 5, 10, 10))).toBe(true);
    expect(rectsOverlap(r(0, 0, 10, 10), r(10, 0, 10, 10))).toBe(false);
    expect(rectsOverlap(r(0, 0, 10, 10), r(2, 2, 2, 2))).toBe(true);
  });

  it("takes the first free candidate and occupies it", () => {
    const index = collisionIndex([r(0, 0, 10, 10)]);
    const first = index.place([r(5, 5, 10, 10), r(20, 0, 10, 10), r(40, 0, 10, 10)]);
    expect(first).toEqual({ rect: r(20, 0, 10, 10), index: 1, free: true });
    // the spot it took is now occupied for the next caller
    const second = index.place([r(20, 0, 10, 10), r(40, 0, 10, 10)]);
    expect(second.index).toBe(1);
  });

  it("falls back to the natural spot when nothing is free, and says so", () => {
    const index = collisionIndex([r(0, 0, 100, 100)]);
    const spot = index.place([r(0, 0, 10, 10), r(50, 50, 10, 10)]);
    expect(spot).toEqual({ rect: r(0, 0, 10, 10), index: 0, free: false });
  });

  it("round-trips a label between its box and the position that draws it", () => {
    const at = { x: 40, y: 20 };
    const size = { w: 30, h: 10 };
    expect(labelAnchor(labelRect(at, size))).toEqual(at);
    // the box hangs above the baseline, where the glyphs are
    expect(labelRect(at, size)).toEqual(r(25, 12, 30, 10));
  });

  it("inflates and deflates a rect symmetrically", () => {
    expect(inflate(r(10, 10, 10, 10), 2)).toEqual(r(8, 8, 14, 14));
    expect(inflate(inflate(r(10, 10, 10, 10), 2), -2)).toEqual(r(10, 10, 10, 10));
  });
});

describe("segmentHitsRect", () => {
  const box = r(10, 10, 20, 20);

  it("catches a line run straight through a box", () => {
    expect(segmentHitsRect({ x: 0, y: 20 }, { x: 40, y: 20 }, box)).toBe(true);
    expect(segmentHitsRect({ x: 0, y: 0 }, { x: 40, y: 40 }, box)).toBe(true);
  });

  it("ignores a line that stops on the border — that is how an edge attaches", () => {
    expect(segmentHitsRect({ x: 0, y: 20 }, { x: 10, y: 20 }, box)).toBe(false);
    expect(segmentHitsRect({ x: 30, y: 20 }, { x: 60, y: 20 }, box)).toBe(false);
  });

  it("does count a line laid ALONG a border — it is drawn over the box's ink", () => {
    expect(segmentHitsRect({ x: 0, y: 10 }, { x: 40, y: 10 }, box)).toBe(true);
    // a caller that wants to forgive that shrinks the box by a hair first
    expect(segmentHitsRect({ x: 0, y: 10 }, { x: 40, y: 10 }, r(11, 11, 18, 18))).toBe(false);
  });

  it("ignores a line that misses, or that ends short of the box", () => {
    expect(segmentHitsRect({ x: 0, y: 50 }, { x: 40, y: 50 }, box)).toBe(false);
    expect(segmentHitsRect({ x: 0, y: 20 }, { x: 5, y: 20 }, box)).toBe(false);
    expect(segmentHitsRect({ x: 0, y: 0 }, { x: 0, y: 0 }, box)).toBe(false);
  });

  it("catches a line that starts inside and leaves", () => {
    expect(segmentHitsRect({ x: 20, y: 20 }, { x: 100, y: 20 }, box)).toBe(true);
  });

  it("asks the same of a whole polyline, one segment at a time", () => {
    const miss = [
      { x: 0, y: 0 },
      { x: 0, y: 40 },
      { x: 5, y: 40 },
    ];
    const hit = [...miss, { x: 40, y: 20 }];
    expect(pathHitsRect(miss, box)).toBe(false);
    expect(pathHitsRect(hit, box)).toBe(true);
  });
});

describe("collisionIndex with routes in it", () => {
  it("treats a routed path as occupied, so a box cannot land on an arrow", () => {
    const index = collisionIndex();
    index.addPath([
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ]);
    expect(index.hits(r(40, 40, 20, 20))).toBe(true);
    expect(index.hits(r(40, 0, 20, 20))).toBe(false);
  });

  it("asks only about boxes when a segment is the thing being tested", () => {
    const index = collisionIndex([r(40, 40, 20, 20)]);
    index.addPath([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(index.crosses({ x: 0, y: 50 }, { x: 100, y: 50 })).toBe(true);
    // two lines crossing is ordinary in a diagram, and not this index's business
    expect(index.crosses({ x: 50, y: -50 }, { x: 50, y: 20 })).toBe(false);
  });
});

describe("placeNote", () => {
  const target = r(100, 100, 40, 40);
  const size = { w: 30, h: 20 };

  it("keeps the side the text asked for when it is free", () => {
    const right = placeNote(collisionIndex(), target, size, "right", 10);
    expect(right.rect).toEqual(r(150, 110, 30, 20));
    expect(right.free).toBe(true);
    const left = placeNote(collisionIndex(), target, size, "left", 10);
    expect(left.rect).toEqual(r(60, 110, 30, 20));
  });

  it("points a leader at the target from wherever it lands", () => {
    const spot = placeNote(collisionIndex(), target, size, "right", 10);
    // starts on the note's border, stops on the target's
    expect(spot.anchor.x1).toBeCloseTo(150, 1);
    expect(spot.anchor.x2).toBeCloseTo(140, 1);
    expect(spot.anchor.y1).toBeCloseTo(120, 1);
  });

  it("slides along the asked-for side before giving up on it", () => {
    // the natural spot is taken, but there is room just above it
    const index = collisionIndex([r(150, 110, 30, 20)]);
    const spot = placeNote(index, target, size, "right", 10);
    expect(spot.free).toBe(true);
    expect(spot.rect.x).toBe(150);
    expect(spot.rect.y).toBeLessThan(110);
  });

  it("crosses to the other side when its own is walled off", () => {
    const index = collisionIndex([r(150, 0, 30, 400)]);
    const spot = placeNote(index, target, size, "right", 10);
    expect(spot.free).toBe(true);
    expect(spot.rect.x).toBe(60); // left of the target
  });

  it("will not land on a routed edge", () => {
    const index = collisionIndex();
    index.addPath([
      { x: 150, y: 0 },
      { x: 150, y: 400 },
    ]);
    const spot = placeNote(index, target, size, "right", 10);
    expect(spot.free).toBe(true);
    expect(spot.rect.x).not.toBe(150);
  });

  it("stays out of negative space, where the view never scrolls", () => {
    const corner = r(0, 0, 40, 40);
    const spot = placeNote(collisionIndex(), corner, size, "left", 10);
    expect(spot.rect.x).toBeGreaterThanOrEqual(0);
    expect(spot.rect.y).toBeGreaterThanOrEqual(0);
  });

  it("keeps the natural spot, and says it is not free, when nothing is clear", () => {
    const spot = placeNote(collisionIndex([r(-2000, -2000, 4000, 4000)]), target, size, "right", 10);
    expect(spot.free).toBe(false);
    expect(spot.rect).toEqual(r(150, 110, 30, 20));
  });
});
