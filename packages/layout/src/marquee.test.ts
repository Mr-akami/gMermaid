import { describe, expect, it } from "vitest";
import { bandRect, marqueeHits, pathHitsBand } from "./marquee";
import type { FlowchartLayout } from "./result";

const box = (id: string, x: number, y: number) => ({ id: id as never, rect: { x, y, w: 40, h: 20 }, label: id, shape: "rect" as const });

const layout: FlowchartLayout = {
  kind: "flowchart",
  size: { w: 400, h: 200 },
  nodes: [box("a", 0, 0), box("b", 100, 0), box("c", 0, 100)],
  edges: [
    {
      id: "e" as never,
      points: [
        { x: 40, y: 10 },
        { x: 100, y: 10 },
      ],
      line: "solid",
      headStart: "none",
      headEnd: "arrow",
    },
  ],
  subgraphs: [],
};

describe("bandRect", () => {
  it("normalises a drag that went up and to the left", () => {
    expect(bandRect({ x: 30, y: 40 }, { x: 10, y: 10 })).toEqual({ x: 10, y: 10, w: 20, h: 30 });
  });
});

describe("pathHitsBand", () => {
  const band = { x: 50, y: 0, w: 10, h: 20 };

  it("catches a segment that crosses the band with both ends outside", () => {
    expect(pathHitsBand([{ x: 0, y: 10 }, { x: 200, y: 10 }], band)).toBe(true);
  });

  it("leaves a segment that passes clear of it", () => {
    expect(pathHitsBand([{ x: 0, y: 90 }, { x: 200, y: 90 }], band)).toBe(false);
  });
});

describe("marqueeHits", () => {
  it("takes every box the band touches, not only the ones it encloses", () => {
    // clips a's right-hand edge only
    expect(marqueeHits(layout, { x: 30, y: 0, w: 20, h: 8 })).toEqual(["a"]);
  });

  it("takes an edge the band crosses", () => {
    expect(marqueeHits(layout, { x: 60, y: 5, w: 10, h: 10 })).toEqual(["e"]);
  });

  it("takes the lot when the band spans the diagram", () => {
    expect(marqueeHits(layout, { x: -10, y: -10, w: 500, h: 500 })).toEqual(["e", "a", "b", "c"]);
  });

  it("takes nothing from a drag that never moved", () => {
    expect(marqueeHits(layout, { x: 10, y: 10, w: 0, h: 0 })).toEqual([]);
  });
});
