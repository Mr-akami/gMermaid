import type { QuadrantPointId } from "./ids";

// Quadrant charts: a title, two axes (`low --> high`), four quadrant labels
// and points `Name: [x, y]` with both coordinates in 0..1.
//
// THE ONE EXCEPTION to "no manual coordinates" (CONTEXT.md): here the
// coordinates ARE the data — a point's place on the chart is what it says —
// so the GUI edits `x`/`y` directly (drag a point, or type them) and there is
// nothing for an auto layout to decide. The layout still derives every pixel
// from the IR; it just maps data space onto the plot instead of searching for
// positions.
//
// Mermaid has no ids: points are identified by name (and duplicates are
// legal), so the IR mints its own. Text is raw mermaid text, always emitted
// quoted — only `"` (no escape) and line breaks cannot be carried.

export interface QuadrantPoint {
  readonly id: QuadrantPointId;
  /** Never empty. */
  readonly label: string;
  /** 0 (left) .. 1 (right). */
  readonly x: number;
  /** 0 (bottom) .. 1 (top). */
  readonly y: number;
}

/** `low --> high`; either end may be empty (= not written). */
export interface QuadrantAxis {
  readonly low: string;
  readonly high: string;
}

export interface QuadrantIR {
  readonly kind: "quadrant";
  readonly title?: string;
  readonly xAxis: QuadrantAxis;
  readonly yAxis: QuadrantAxis;
  /** `quadrant-1..4` in mermaid's order: top-right, top-left, bottom-left,
   * bottom-right. Empty = not written. */
  readonly quadrants: readonly [string, string, string, string];
  readonly points: readonly QuadrantPoint[];
}

export type QuadrantIndex = 0 | 1 | 2 | 3;

/** Where each `quadrant-N` sits, index 0 = `quadrant-1`. */
export const QUADRANT_POSITIONS = ["top-right", "top-left", "bottom-left", "bottom-right"] as const;

export function emptyQuadrant(): QuadrantIR {
  return {
    kind: "quadrant",
    xAxis: { low: "", high: "" },
    yAxis: { low: "", high: "" },
    quadrants: ["", "", "", ""],
    points: [],
  };
}

/** Text lives inside `"…"` on emit, which has no escape for `"`; a line break
 * would end the statement. `"` becomes `'` (the closest reading), runs of
 * whitespace one space. Applied at the IR boundary (GUI input) and by
 * codegen. */
export function sanitizeQuadrantText(text: string): string {
  return text.replaceAll('"', "'").replaceAll(/\s+/g, " ").trim();
}

/** Why `label` cannot name a point, or undefined when it can. mermaid refuses
 * a point with an empty name. */
export function quadrantLabelRejection(label: string): string | undefined {
  return sanitizeQuadrantText(label) === "" ? "a point needs a name" : undefined;
}

/** Coordinates are data in 0..1, kept to 4 decimals so the text stays
 * readable and never turns into an exponent (`1e-7`, which mermaid cannot
 * read). Not a number = the middle. */
export function clampUnit(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;
}
