// The one injected port that keeps layout pure (ADR 0001): text metrics come
// from the caller, never from the DOM inside this package.
export interface TextStyle {
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly bold?: boolean;
}

export interface TextMeasurer {
  measure(text: string, style: TextStyle): { w: number; h: number };
}

/** Deterministic measurer for tests and golden layouts. */
export function fixedWidthMeasurer(charWidth = 8): TextMeasurer {
  return {
    measure(text, style) {
      return { w: text.length * charWidth, h: style.fontSize * 1.4 };
    },
  };
}

/** Breathing room when reserving dagre space for an edge label. */
export const EDGE_LABEL_PAD = 4;

/**
 * Dagre only keeps a gap clear for an edge label when it is told the label's
 * size; otherwise the label is dropped on the polyline afterwards and lands
 * on whatever is there — usually the two nodes the edge runs between.
 */
export function edgeLabelSize(
  label: string | undefined,
  measure: TextMeasurer,
  style: TextStyle,
): { width: number; height: number; labelpos: "c" } | Record<string, never> {
  if (label === undefined || label === "") return {};
  const m = measure.measure(label, style);
  return { width: m.w + EDGE_LABEL_PAD * 2, height: m.h + EDGE_LABEL_PAD * 2, labelpos: "c" };
}
