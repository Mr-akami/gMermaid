import { QUADRANT_POSITIONS, type QuadrantIR, type QuadrantIndex, type QuadrantPoint } from "@gmermaid/ir";

// Two faces: a selected point (its name and its DATA — x and y are the
// diagram's one directly-edited coordinate pair), or, with nothing selected,
// the chart itself: axes and quadrant labels.

export interface QuadrantPointWindowProps {
  readonly point: QuadrantPoint;
  readonly onChangeLabel: (label: string) => void;
  readonly onChangeCoords: (x: number, y: number) => void;
  readonly onDelete: () => void;
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
}

/** A half-typed or empty number field keeps the value it had. */
const num = (raw: string, fallback: number): number => (raw.trim() === "" || Number.isNaN(Number(raw)) ? fallback : Number(raw));

export function QuadrantPointWindow({ point, onChangeLabel, onChangeCoords, onDelete, onEditStart, onEditEnd }: QuadrantPointWindowProps) {
  return (
    <div className="property-window">
      <h3>Point</h3>
      <label>
        Name
        <input value={point.label} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => onChangeLabel(e.target.value)} />
      </label>
      <label>
        X (0 – 1)
        <input
          type="number"
          min={0}
          max={1}
          step={0.01}
          value={point.x}
          onFocus={onEditStart}
          onBlur={onEditEnd}
          onChange={(e) => onChangeCoords(num(e.target.value, point.x), point.y)}
        />
      </label>
      <label>
        Y (0 – 1)
        <input
          type="number"
          min={0}
          max={1}
          step={0.01}
          value={point.y}
          onFocus={onEditStart}
          onBlur={onEditEnd}
          onChange={(e) => onChangeCoords(point.x, num(e.target.value, point.y))}
        />
      </label>
      <p className="hint">Drag the point on the chart to move it.</p>
      <button className="danger" onClick={onDelete}>
        Delete point
      </button>
    </div>
  );
}

export interface QuadrantChartWindowProps {
  readonly ir: QuadrantIR;
  readonly onAxis: (axis: "x" | "y", end: "low" | "high", text: string) => void;
  readonly onQuadrantLabel: (index: QuadrantIndex, text: string) => void;
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
}

const QUADRANT_INDEXES: readonly QuadrantIndex[] = [0, 1, 2, 3];

export function QuadrantChartWindow({ ir, onAxis, onQuadrantLabel, onEditStart, onEditEnd }: QuadrantChartWindowProps) {
  return (
    <div className="property-window" aria-label="Chart settings">
      <h3>Chart</h3>
      <label>
        X axis, low
        <input value={ir.xAxis.low} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => onAxis("x", "low", e.target.value)} />
      </label>
      <label>
        X axis, high
        <input value={ir.xAxis.high} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => onAxis("x", "high", e.target.value)} />
      </label>
      <label>
        Y axis, low
        <input value={ir.yAxis.low} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => onAxis("y", "low", e.target.value)} />
      </label>
      <label>
        Y axis, high
        <input value={ir.yAxis.high} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => onAxis("y", "high", e.target.value)} />
      </label>
      {QUADRANT_INDEXES.map((i) => (
        <label key={i}>
          Quadrant {i + 1} ({QUADRANT_POSITIONS[i]})
          <input
            value={ir.quadrants[i]}
            onFocus={onEditStart}
            onBlur={onEditEnd}
            onChange={(e) => onQuadrantLabel(i, e.target.value)}
          />
        </label>
      ))}
    </div>
  );
}
