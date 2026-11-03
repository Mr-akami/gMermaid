import { clampUnit, type QuadrantIR, type QuadrantPointId } from "@gmermaid/ir";
import type { TextMeasurer, TextStyle } from "./measurer";
import type { Point, Rect } from "./result";

// A quadrant chart has no layout to search for: the plot is a fixed square and
// a point's position IS its data — `x`/`y` in 0..1 map linearly onto it. This
// is the one diagram whose coordinates are edited directly (see the IR), so
// the mapping both ways is part of this module's contract: the editor turns a
// drag back into data with `plotToQuadrant`, never with its own arithmetic.
// Arithmetic only — no dagre.

const TITLE_STYLE: TextStyle = { fontSize: 18, fontFamily: "sans-serif", bold: true };
const AXIS_STYLE: TextStyle = { fontSize: 13, fontFamily: "sans-serif" };
const POINT_STYLE: TextStyle = { fontSize: 12, fontFamily: "sans-serif" };

export const QUADRANT_PLOT_SIZE = 440;
const LEFT = 48;
const BOTTOM = 36;
const TITLE_H = 40;
export const QUADRANT_POINT_RADIUS = 7;

/** A quadrant's cell. `index` 1..4 is mermaid's `quadrant-N`. */
export interface QuadrantCell {
  readonly index: 1 | 2 | 3 | 4;
  readonly rect: Rect;
  readonly label: string;
  readonly labelPos: Point;
}

export interface QuadrantAxisLabel {
  readonly text: string;
  readonly pos: Point;
  readonly anchor: "start" | "end";
  /** Rotated a quarter turn counter-clockwise about `pos` (the y axis). */
  readonly rotated: boolean;
}

export interface QuadrantDot {
  readonly id: QuadrantPointId;
  readonly label: string;
  /** The data, as in the IR. */
  readonly x: number;
  readonly y: number;
  /** Where the dot is drawn. */
  readonly center: Point;
  readonly labelPos: Point;
  /** The dot and its label: what a click or a marquee hits. */
  readonly rect: Rect;
}

export interface QuadrantLayout {
  readonly kind: "quadrant";
  readonly size: { readonly w: number; readonly h: number };
  readonly title?: string;
  readonly titlePos?: Point;
  /** The square the data maps onto. */
  readonly plot: Rect;
  /** `quadrant-1` (top right) .. `quadrant-4` (bottom right). */
  readonly cells: readonly QuadrantCell[];
  readonly axes: readonly QuadrantAxisLabel[];
  readonly points: readonly QuadrantDot[];
}

/** Data → plot pixels (y grows upward in the data, downward on screen). */
export function quadrantToPlot(plot: Rect, x: number, y: number): Point {
  return { x: plot.x + x * plot.w, y: plot.y + (1 - y) * plot.h };
}

/** Plot pixels → data, clamped to the plot and rounded like every other
 * coordinate (2 decimals: a drag should land on a readable number). */
export function plotToQuadrant(plot: Rect, px: number, py: number): { x: number; y: number } {
  return { x: roundUnit((px - plot.x) / plot.w), y: roundUnit(1 - (py - plot.y) / plot.h) };
}

const roundUnit = (v: number): number => clampUnit(Math.round(v * 100) / 100);

function width(measure: TextMeasurer, text: string, style: TextStyle): number {
  return text === "" ? 0 : measure.measure(text, style).w;
}

export function layoutQuadrant(ir: QuadrantIR, measure: TextMeasurer): QuadrantLayout {
  const title = ir.title !== undefined && ir.title !== "" ? ir.title : undefined;
  const top = title !== undefined ? TITLE_H : 0;
  const plot: Rect = { x: LEFT, y: top, w: QUADRANT_PLOT_SIZE, h: QUADRANT_PLOT_SIZE };
  const half = QUADRANT_PLOT_SIZE / 2;

  // mermaid's order: 1 top right, 2 top left, 3 bottom left, 4 bottom right
  const origins: readonly (readonly [1 | 2 | 3 | 4, number, number])[] = [
    [1, plot.x + half, plot.y],
    [2, plot.x, plot.y],
    [3, plot.x, plot.y + half],
    [4, plot.x + half, plot.y + half],
  ];
  const cells: QuadrantCell[] = origins.map(([index, x, y]) => ({
    index,
    rect: { x, y, w: half, h: half },
    label: ir.quadrants[index - 1] ?? "",
    labelPos: { x: x + half / 2, y: y + 20 },
  }));

  const axisY = plot.y + plot.h + 22;
  const axisX = plot.x - 14;
  const axes: QuadrantAxisLabel[] = [];
  const add = (a: QuadrantAxisLabel): void => {
    if (a.text !== "") axes.push(a);
  };
  add({ text: ir.xAxis.low, pos: { x: plot.x, y: axisY }, anchor: "start", rotated: false });
  add({ text: ir.xAxis.high, pos: { x: plot.x + plot.w, y: axisY }, anchor: "end", rotated: false });
  add({ text: ir.yAxis.low, pos: { x: axisX, y: plot.y + plot.h }, anchor: "start", rotated: true });
  add({ text: ir.yAxis.high, pos: { x: axisX, y: plot.y }, anchor: "end", rotated: true });

  const lineH = measure.measure("x", POINT_STYLE).h;
  const points: QuadrantDot[] = ir.points.map((p) => {
    const center = quadrantToPlot(plot, p.x, p.y);
    const lw = width(measure, p.label, POINT_STYLE);
    const halfW = Math.max(QUADRANT_POINT_RADIUS, lw / 2);
    return {
      id: p.id,
      label: p.label,
      x: p.x,
      y: p.y,
      center,
      labelPos: { x: center.x, y: center.y + QUADRANT_POINT_RADIUS + lineH / 2 + 2 },
      rect: {
        x: center.x - halfW,
        y: center.y - QUADRANT_POINT_RADIUS,
        w: halfW * 2,
        h: QUADRANT_POINT_RADIUS * 2 + lineH + 2,
      },
    };
  });

  // the plot is the frame; titles, axis labels and a long point label can
  // only widen it
  let w = plot.x + plot.w;
  if (title !== undefined) w = Math.max(w, width(measure, title, TITLE_STYLE));
  for (const a of axes) if (!a.rotated) w = Math.max(w, a.pos.x + (a.anchor === "start" ? width(measure, a.text, AXIS_STYLE) : 0));
  for (const p of points) w = Math.max(w, p.rect.x + p.rect.w);

  return {
    kind: "quadrant",
    size: { w, h: plot.y + plot.h + BOTTOM },
    ...(title !== undefined ? { title, titlePos: { x: plot.x + plot.w / 2, y: TITLE_H / 2 } } : {}),
    plot,
    cells,
    axes,
    points,
  };
}

