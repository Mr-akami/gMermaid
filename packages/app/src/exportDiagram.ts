// Export the canvas as a standalone SVG / PNG. The canvas SVG leans on CSS
// custom properties (`var(--gm-stroke, #333)`) that only exist in the page,
// so a file opened elsewhere would lose its colours: every var() is resolved
// to a literal first. The pan/zoom transform and the marquee band are
// view state, not diagram — they are cut out and the viewBox is the drawn
// extent (the same measure "Fit view" uses) plus a margin.

const ROOT_ATTR = "data-gm-root";
const SVG_NS = "http://www.w3.org/2000/svg";
export const EXPORT_PADDING = 16;

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Replace every `var(--name, fallback)` with the resolved value, else the
 * fallback. Balanced-paren scan: fallbacks hold `rgba(…)`. */
export function inlineCssVars(text: string, resolve: (name: string) => string | undefined): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("var(", i);
    if (start === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, start);
    let depth = 0;
    let end = start + 3;
    for (; end < text.length; end++) {
      if (text[end] === "(") depth++;
      else if (text[end] === ")" && --depth === 0) break;
    }
    const body = text.slice(start + 4, end);
    const comma = body.indexOf(",");
    const name = (comma === -1 ? body : body.slice(0, comma)).trim();
    const fallback = comma === -1 ? "" : body.slice(comma + 1).trim();
    const value = resolve(name)?.trim();
    out += inlineCssVars(value !== undefined && value !== "" ? value : fallback, resolve);
    i = end + 1;
  }
  return out;
}

export interface BuiltSvg {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
}

export function buildExportSvg(
  source: SVGSVGElement,
  opts: { readonly box: Box; readonly background: string; readonly resolveVar: (name: string) => string | undefined },
): BuiltSvg {
  const { box } = opts;
  const x = box.x - EXPORT_PADDING;
  const y = box.y - EXPORT_PADDING;
  const width = Math.ceil(box.w + EXPORT_PADDING * 2);
  const height = Math.ceil(box.h + EXPORT_PADDING * 2);

  const svg = source.cloneNode(true) as SVGSVGElement;
  for (const child of Array.from(svg.children)) {
    // keep <defs> (markers) and the diagram root; drop the marquee band etc.
    if (child.tagName.toLowerCase() === "defs") continue;
    if (child.hasAttribute(ROOT_ATTR)) {
      child.removeAttribute("transform");
      continue;
    }
    child.remove();
  }
  svg.removeAttribute("style");
  svg.removeAttribute("class");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);

  const bg = svg.ownerDocument.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", String(x));
  bg.setAttribute("y", String(y));
  bg.setAttribute("width", String(width));
  bg.setAttribute("height", String(height));
  bg.setAttribute("fill", opts.background);
  svg.insertBefore(bg, svg.firstChild);

  const markup = new XMLSerializer().serializeToString(svg);
  return { svg: inlineCssVars(markup, opts.resolveVar), width, height };
}

/** The drawing on screen: its <svg> and the extent it occupies. */
function findCanvasSvg(): { svg: SVGSVGElement; box: Box } | undefined {
  const root = document.querySelector(`.editor:not(.hidden) .canvas [${ROOT_ATTR}]`);
  if (!(root instanceof SVGGraphicsElement) || root.ownerSVGElement === null) return undefined;
  try {
    const b = root.getBBox();
    return { svg: root.ownerSVGElement, box: { x: b.x, y: b.y, w: b.width, h: b.height } };
  } catch {
    return undefined;
  }
}

function build(): BuiltSvg | undefined {
  const found = findCanvasSvg();
  if (found === undefined) return undefined;
  const style = getComputedStyle(document.documentElement);
  return buildExportSvg(found.svg, {
    box: found.box,
    background: style.getPropertyValue("--surface").trim() || "#ffffff",
    resolveVar: (name) => style.getPropertyValue(name),
  });
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportSvg(basename: string): boolean {
  const built = build();
  if (built === undefined) return false;
  download(new Blob([built.svg], { type: "image/svg+xml;charset=utf-8" }), `${basename}.svg`);
  return true;
}

const MAX_SIDE = 8192;

export async function exportPng(basename: string, scale = 2): Promise<boolean> {
  const built = build();
  if (built === undefined) return false;
  const s = Math.min(scale, MAX_SIDE / Math.max(built.width, built.height));
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(built.svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(built.width * s));
  canvas.height = Math.max(1, Math.round(built.height * s));
  const ctx = canvas.getContext("2d");
  if (ctx === null) return false;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (blob === null) return false;
  download(blob, `${basename}.png`);
  return true;
}
