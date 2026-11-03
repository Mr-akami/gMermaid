import type { QuadrantCell, QuadrantDot, QuadrantLayout } from "@gmermaid/layout";
import { QUADRANT_POINT_RADIUS } from "@gmermaid/layout";
import { usePointerGestures, type Viewport, type SelectionGestures } from "./usePointerGestures";
import { MarqueeRect, selectionOf } from "./Marquee";

export interface QuadrantViewState {
  readonly selectedId?: string | undefined;
  /** The whole selection; `selectedId` is always one of these. */
  readonly selectedIds?: readonly string[] | undefined;
}

export interface QuadrantViewProps {
  readonly layout: QuadrantLayout;
  readonly viewState: QuadrantViewState;
  /** Pan/zoom; undefined = default (identity, padding offset). */
  readonly viewport?: Viewport | undefined;
  readonly onViewportChange?: ((v: Viewport) => void) | undefined;
  /** `additive` = Ctrl/Cmd/Shift was held: add to the selection. */
  readonly onElementClick?: (id: string, additive: boolean) => void;
  readonly onBackgroundClick?: () => void;
  /** Marquee and context-menu gestures (see SelectionGestures). */
  readonly select?: SelectionGestures | undefined;
  /** A point is dragged: the pointer in DIAGRAM coordinates, live and on
   * release. The caller turns it into data with `plotToQuadrant`. */
  readonly onPointDrag?: (id: string, x: number, y: number) => void;
  readonly onPointDrop?: (id: string, x: number, y: number) => void;
  readonly onGestureCancel?: () => void;
}

const PADDING = 20;

// One tint per quadrant, in mermaid's order (1 top right … 4 bottom right).
const TINTS = ["#5aab72", "#4f82c4", "#a06fbf", "#c98a3d"] as const;
const DOT = "#4f82c4";

export function QuadrantView({
  layout,
  viewState,
  viewport,
  onViewportChange,
  onElementClick,
  onBackgroundClick,
  select,
  onPointDrag,
  onPointDrop,
  onGestureCancel,
}: QuadrantViewProps) {
  const sel = selectionOf(viewState);
  const g = usePointerGestures({
    padding: PADDING,
    viewport,
    onViewportChange,
    dragKinds: ["point"],
    onElementClick,
    onBackgroundClick,
    selection: select,
    onDrag: (_kind, id, x, y) => onPointDrag?.(id, x, y),
    onDrop: (_kind, id, x, y) => onPointDrop?.(id, x, y),
    onGestureCancel,
  });
  const { plot } = layout;

  return (
    <svg
      width="100%"
      height="100%"
      ref={g.ref}
      onPointerDown={g.onPointerDown}
      onPointerMove={g.onPointerMove}
      onPointerUp={g.onPointerUp}
      onPointerCancel={g.onPointerCancel}
      onContextMenu={g.onContextMenu}
      style={g.style}
    >
      <g transform={`translate(${g.viewport.x} ${g.viewport.y}) scale(${g.viewport.scale})`} data-gm-root="">
        {layout.title !== undefined && layout.titlePos !== undefined && (
          <text
            x={layout.titlePos.x}
            y={layout.titlePos.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={18}
            fontWeight={700}
            fontFamily="sans-serif"
            fill="var(--gm-text, #111)"
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            {layout.title}
          </text>
        )}
        {layout.cells.map((c) => (
          <CellView key={c.index} cell={c} />
        ))}
        <rect
          data-testid="quadrant-plot"
          x={plot.x}
          y={plot.y}
          width={plot.w}
          height={plot.h}
          fill="none"
          stroke="var(--gm-text, #555)"
          strokeOpacity={0.55}
          strokeWidth={1.5}
          style={{ pointerEvents: "none" }}
        />
        {layout.axes.map((a, i) => (
          <text
            key={i}
            x={a.pos.x}
            y={a.pos.y}
            textAnchor={a.anchor}
            dominantBaseline="central"
            fontSize={13}
            fontFamily="sans-serif"
            fill="var(--gm-text, #333)"
            transform={a.rotated ? `rotate(-90 ${a.pos.x} ${a.pos.y})` : undefined}
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            {a.text}
          </text>
        ))}
        {layout.points.map((p) => (
          <PointView key={p.id} point={p} selected={sel.has(p.id)} />
        ))}
      </g>
      {g.band !== undefined && (
        <g transform={`translate(${g.viewport.x} ${g.viewport.y}) scale(${g.viewport.scale})`}>
          <MarqueeRect band={g.band} />
        </g>
      )}
    </svg>
  );
}

function CellView({ cell }: { cell: QuadrantCell }) {
  const { x, y, w, h } = cell.rect;
  return (
    <g style={{ pointerEvents: "none" }}>
      <rect x={x} y={y} width={w} height={h} fill={TINTS[cell.index - 1]} fillOpacity={0.12} stroke="var(--gm-text, #555)" strokeOpacity={0.25} />
      {cell.label !== "" && (
        <text
          x={cell.labelPos.x}
          y={cell.labelPos.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={14}
          fontWeight={700}
          fontFamily="sans-serif"
          fill="var(--gm-text, #333)"
          fillOpacity={0.7}
          style={{ userSelect: "none" }}
        >
          {cell.label}
        </text>
      )}
    </g>
  );
}

function PointView({ point, selected }: { point: QuadrantDot; selected: boolean }) {
  const { center, rect } = point;
  return (
    <g data-element-id={point.id} data-drag="point" style={{ cursor: "grab" }}>
      {/* the dot and its label are one hit area */}
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="transparent" stroke="none" />
      <circle
        cx={center.x}
        cy={center.y}
        r={QUADRANT_POINT_RADIUS}
        fill={DOT}
        fillOpacity={0.85}
        stroke={selected ? "var(--gm-selected, #1a73e8)" : "#fff"}
        strokeWidth={selected ? 3 : 1.5}
      />
      <text
        x={point.labelPos.x}
        y={point.labelPos.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={12}
        fontFamily="sans-serif"
        fill="var(--gm-text, #111)"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {point.label}
      </text>
    </g>
  );
}
