import { describe, expect, it } from "vitest";
import { collisionIndex, inflate, labelAnchor, labelRect, rectsOverlap } from "./collision";

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
