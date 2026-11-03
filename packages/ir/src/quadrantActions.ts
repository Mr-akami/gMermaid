import type { QuadrantPointId } from "./ids";
import { clampUnit, sanitizeQuadrantText, type QuadrantIR, type QuadrantIndex, type QuadrantPoint } from "./quadrant";

// Same contract as the other diagram actions: intent-carrying, immutable,
// identity-preserving on no-ops.

export type QuadrantAction =
  /** An empty title removes it. */
  | { type: "setTitle"; title: string }
  | { type: "setAxis"; axis: "x" | "y"; low?: string; high?: string }
  /** `index` 0..3 = `quadrant-1..4`. */
  | { type: "setQuadrantLabel"; index: QuadrantIndex; label: string }
  | { type: "addPoint"; point: QuadrantPoint }
  | { type: "removePoint"; id: QuadrantPointId }
  | { type: "updatePoint"; id: QuadrantPointId; label?: string }
  /** Drag / typed coordinates: clamped to 0..1. */
  | { type: "movePoint"; id: QuadrantPointId; x: number; y: number };

export function applyQuadrantAction(ir: QuadrantIR, action: QuadrantAction): QuadrantIR {
  switch (action.type) {
    case "setTitle": {
      const title = sanitizeQuadrantText(action.title);
      if (title === (ir.title ?? "")) return ir;
      const { title: _dropped, ...rest } = ir;
      return title === "" ? rest : { ...rest, title };
    }

    case "setAxis": {
      const key = action.axis === "x" ? "xAxis" : "yAxis";
      const cur = ir[key];
      const low = action.low !== undefined ? sanitizeQuadrantText(action.low) : cur.low;
      const high = action.high !== undefined ? sanitizeQuadrantText(action.high) : cur.high;
      if (low === cur.low && high === cur.high) return ir;
      return { ...ir, [key]: { low, high } };
    }

    case "setQuadrantLabel": {
      const label = sanitizeQuadrantText(action.label);
      if (label === ir.quadrants[action.index]) return ir;
      const quadrants = [...ir.quadrants] as [string, string, string, string];
      quadrants[action.index] = label;
      return { ...ir, quadrants };
    }

    case "addPoint": {
      const p = action.point;
      if (ir.points.some((x) => x.id === p.id)) return ir;
      const label = sanitizeQuadrantText(p.label);
      if (label === "") return ir;
      return { ...ir, points: [...ir.points, { id: p.id, label, x: clampUnit(p.x), y: clampUnit(p.y) }] };
    }

    case "removePoint": {
      if (!ir.points.some((p) => p.id === action.id)) return ir;
      return { ...ir, points: ir.points.filter((p) => p.id !== action.id) };
    }

    case "updatePoint": {
      const p = ir.points.find((x) => x.id === action.id);
      if (!p) return ir;
      const label = action.label !== undefined ? sanitizeQuadrantText(action.label) : p.label;
      if (label === "" || label === p.label) return ir;
      return { ...ir, points: ir.points.map((x) => (x.id === action.id ? { ...x, label } : x)) };
    }

    case "movePoint": {
      const p = ir.points.find((x) => x.id === action.id);
      if (!p) return ir;
      const x = clampUnit(action.x);
      const y = clampUnit(action.y);
      if (x === p.x && y === p.y) return ir;
      return { ...ir, points: ir.points.map((q) => (q.id === action.id ? { ...q, x, y } : q)) };
    }
  }
}
