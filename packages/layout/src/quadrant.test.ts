import { describe, expect, it } from "vitest";
import type { QuadrantIR, QuadrantPointId } from "@gmermaid/ir";
import { fixedWidthMeasurer } from "./measurer";
import { layoutQuadrant, plotToQuadrant, quadrantToPlot, QUADRANT_PLOT_SIZE } from "./quadrant";
import { marqueeHits } from "./marquee";

const P = (s: string) => s as QuadrantPointId;

const ir: QuadrantIR = {
  kind: "quadrant",
  title: "Reach and engagement",
  xAxis: { low: "Low Reach", high: "High Reach" },
  yAxis: { low: "Low Engagement", high: "High Engagement" },
  quadrants: ["We should expand", "Need to promote", "Re-evaluate", "May be improved"],
  points: [
    { id: P("a"), label: "Campaign A", x: 0.3, y: 0.6 },
    { id: P("b"), label: "Campaign B", x: 0.9, y: 0.1 },
  ],
};

describe("layoutQuadrant", () => {
  it("matches the committed golden layout", () => {
    expect(layoutQuadrant(ir, fixedWidthMeasurer())).toMatchSnapshot();
  });

  it("puts quadrant-1 top right, 2 top left, 3 bottom left, 4 bottom right", () => {
    const { cells, plot } = layoutQuadrant(ir, fixedWidthMeasurer());
    const [q1, q2, q3, q4] = cells.map((c) => c.rect);
    expect(q1!.x).toBeGreaterThan(q2!.x);
    expect(q1!.y).toBe(q2!.y);
    expect(q3!.y).toBeGreaterThan(q2!.y);
    expect(q3!.x).toBe(q2!.x);
    expect(q4!.x).toBe(q1!.x);
    expect(q4!.y).toBe(q3!.y);
    for (const c of cells) expect(c.rect.w * 2).toBe(plot.w);
  });

  it("maps data linearly: x grows right, y grows UP", () => {
    const { points, plot } = layoutQuadrant(ir, fixedWidthMeasurer());
    const [a, b] = points;
    expect(a!.center).toEqual(quadrantToPlot(plot, 0.3, 0.6));
    expect(b!.center.x).toBeGreaterThan(a!.center.x);
    expect(b!.center.y).toBeGreaterThan(a!.center.y); // lower on screen = lower value
    expect(a!.center.x).toBeCloseTo(plot.x + 0.3 * QUADRANT_PLOT_SIZE);
  });

  it("plotToQuadrant inverts quadrantToPlot, clamps and rounds to 2 decimals", () => {
    const { plot } = layoutQuadrant(ir, fixedWidthMeasurer());
    const at = quadrantToPlot(plot, 0.37, 0.82);
    expect(plotToQuadrant(plot, at.x, at.y)).toEqual({ x: 0.37, y: 0.82 });
    expect(plotToQuadrant(plot, plot.x - 500, plot.y - 500)).toEqual({ x: 0, y: 1 });
    expect(plotToQuadrant(plot, plot.x + plot.w + 500, plot.y + plot.h + 500)).toEqual({ x: 1, y: 0 });
  });

  it("is stable under an empty chart and omits what is not written", () => {
    const l = layoutQuadrant({ kind: "quadrant", xAxis: { low: "", high: "" }, yAxis: { low: "", high: "" }, quadrants: ["", "", "", ""], points: [] }, fixedWidthMeasurer());
    expect(l.title).toBeUndefined();
    expect(l.axes).toEqual([]);
    expect(l.points).toEqual([]);
    expect(l.plot.y).toBe(0);
  });

  it("the marquee hits exactly the points it touches", () => {
    const l = layoutQuadrant(ir, fixedWidthMeasurer());
    const a = l.points[0]!;
    expect(marqueeHits(l, { x: a.center.x - 2, y: a.center.y - 2, w: 4, h: 4 })).toEqual(["a"]);
    expect(marqueeHits(l, l.plot)).toEqual(["a", "b"]);
  });
});
