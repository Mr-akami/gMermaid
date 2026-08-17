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
