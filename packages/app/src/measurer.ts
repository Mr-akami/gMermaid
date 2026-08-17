import type { TextMeasurer, TextStyle } from "@gmermaid/layout";

// Production TextMeasurer backed by canvas measureText (the DOM stays on
// this side of the layout boundary — ADR 0001). The canvas is created
// lazily so importing this module is safe outside a browser, and results
// are cached because layout re-measures every label on each update.
function canvasMeasurer(): TextMeasurer {
  let ctx: CanvasRenderingContext2D | undefined;
  const cache = new Map<string, { w: number; h: number }>();
  return {
    measure(text: string, style: TextStyle) {
      const key = `${style.fontSize}|${style.fontFamily}|${style.bold ? 1 : 0}|${text}`;
      const hit = cache.get(key);
      if (hit) return hit;
      ctx ??= document.createElement("canvas").getContext("2d")!;
      ctx.font = `${style.bold ? "bold " : ""}${style.fontSize}px ${style.fontFamily}`;
      const size = { w: ctx.measureText(text).width, h: style.fontSize * 1.4 };
      cache.set(key, size);
      return size;
    },
  };
}

export const measurer: TextMeasurer = canvasMeasurer();
