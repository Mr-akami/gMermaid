/**
 * Edge geometry as an SVG path.
 *
 * The layout hands us a dagre polyline. Drawing it with `L` segments is what
 * makes gMermaid's diagrams look angular next to mermaid's: mermaid feeds the
 * same points through d3's `curveBasis`, a uniform cubic B-spline, so the
 * corners round off and the long diagonals read as one flowing line.
 *
 * This is that curve, written out so the renderer keeps no d3 dependency.
 * Like d3 it starts at the first point and ends at the last, and only
 * approximates the ones in between — which is exactly what rounds the corners.
 */

export interface PathPoint {
  readonly x: number;
  readonly y: number;
}

const n = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(2));

/** Drop points that repeat or sit on the straight line between their
 * neighbours: they add nothing and make the spline sag toward them. */
function simplify(points: readonly PathPoint[]): PathPoint[] {
  const out: PathPoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push(p);
  }
  return out;
}

export function edgePath(points: readonly PathPoint[]): string {
  const p = simplify(points);
  if (p.length === 0) return "";
  if (p.length === 1) return `M ${n(p[0]!.x)} ${n(p[0]!.y)}`;
  if (p.length === 2) return `M ${n(p[0]!.x)} ${n(p[0]!.y)} L ${n(p[1]!.x)} ${n(p[1]!.y)}`;

  const d: string[] = [`M ${n(p[0]!.x)} ${n(p[0]!.y)}`];
  // d3's basis curve: the first segment is a straight run into the spline,
  // the last one back out of it, so both ends stay anchored on the polyline.
  d.push(`L ${n((5 * p[0]!.x + p[1]!.x) / 6)} ${n((5 * p[0]!.y + p[1]!.y) / 6)}`);
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1]!;
    const b = p[i]!;
    const c = p[i + 1]!;
    d.push(
      `C ${n((2 * a.x + b.x) / 3)} ${n((2 * a.y + b.y) / 3)}` +
        ` ${n((a.x + 2 * b.x) / 3)} ${n((a.y + 2 * b.y) / 3)}` +
        ` ${n((a.x + 4 * b.x + c.x) / 6)} ${n((a.y + 4 * b.y + c.y) / 6)}`,
    );
  }
  const last = p[p.length - 1]!;
  const prev = p[p.length - 2]!;
  d.push(
    `C ${n((2 * prev.x + last.x) / 3)} ${n((2 * prev.y + last.y) / 3)}` +
      ` ${n((prev.x + 2 * last.x) / 3)} ${n((prev.y + 2 * last.y) / 3)}` +
      ` ${n(last.x)} ${n(last.y)}`,
  );
  return d.join(" ");
}
