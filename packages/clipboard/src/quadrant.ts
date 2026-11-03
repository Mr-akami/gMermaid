import type { QuadrantIR, QuadrantPoint } from "@gmermaid/ir";
import { clampUnit, newId, quadrantLabelRejection } from "@gmermaid/ir";
import type { KindClipboard, MergeResult } from "./kind";

/**
 * Closure: only points are selectable, so a slice is exactly the selected
 * points. Axes and quadrant labels travel with it so the text reads on its
 * own, but paste never touches the target's (diagram-level settings, like a
 * flowchart's direction); the title is not copied at all.
 */
function slice(ir: QuadrantIR, ids: ReadonlySet<string>): QuadrantIR | undefined {
  const points = ir.points.filter((p) => ids.has(p.id));
  if (points.length === 0) return undefined;
  const { title: _title, ...rest } = ir;
  return { ...rest, points };
}

/** Pasted points keep their coordinates — they ARE the data — and land on top
 * of the originals, which is what a copy of a point on a chart means. */
function merge(ir: QuadrantIR, inc: QuadrantIR): MergeResult<QuadrantIR> {
  const points: QuadrantPoint[] = inc.points
    .filter((p) => quadrantLabelRejection(p.label) === undefined)
    .map((p) => ({ id: newId("quadrantPoint"), label: p.label, x: clampUnit(p.x), y: clampUnit(p.y) }));
  if (points.length === 0) return { reason: "nothing in the clipboard could be pasted here" };
  return { ir: { ...ir, points: [...ir.points, ...points] }, added: points.map((p) => p.id) };
}

export const quadrantClipboard: KindClipboard<QuadrantIR> = { slice, merge };
