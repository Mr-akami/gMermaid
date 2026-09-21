import type { GanttBar, GanttLayout, GanttSectionBand, GanttVert } from "@gmermaid/layout";
import { usePointerGestures, type Viewport } from "./usePointerGestures";

export interface GanttViewState {
  readonly selectedId?: string | undefined;
}

export interface GanttViewProps {
  readonly layout: GanttLayout;
  readonly viewState: GanttViewState;
  /** Pan/zoom; undefined = default (identity, padding offset). */
  readonly viewport?: Viewport | undefined;
  readonly onViewportChange?: ((v: Viewport) => void) | undefined;
  readonly onElementClick?: (id: string) => void;
  readonly onBackgroundClick?: () => void;
}

const PADDING = 20;

// Bar fills follow mermaid's own tag precedence: crit beats active beats
// done. The layout stays pure data, so the palette lives here.
const BAR_FILL = {
  crit: "#d9534f",
  active: "#5b9bd5",
  done: "#b6bec9",
  plain: "#8fb2d9",
} as const;

function fillOf(bar: GanttBar): string {
  if (bar.tags.includes("crit")) return BAR_FILL.crit;
  if (bar.tags.includes("active")) return BAR_FILL.active;
  if (bar.tags.includes("done")) return BAR_FILL.done;
  return BAR_FILL.plain;
}

export function GanttView({
  layout,
  viewState,
  viewport,
  onViewportChange,
  onElementClick,
  onBackgroundClick,
}: GanttViewProps) {
  const g = usePointerGestures({
    padding: PADDING,
    viewport,
    onViewportChange,
    dragKinds: [],
    onElementClick,
    onBackgroundClick,
  });

  const chartRight = layout.chartX + layout.chartW;

  return (
    <svg
      width="100%"
      height="100%"
      ref={g.ref}
      onPointerDown={g.onPointerDown}
      onPointerMove={g.onPointerMove}
      onPointerUp={g.onPointerUp}
      onPointerCancel={g.onPointerCancel}
      style={g.style}
    >
      <g transform={`translate(${g.viewport.x} ${g.viewport.y}) scale(${g.viewport.scale})`}>
        {layout.title !== undefined && (
          <text
            x={(layout.chartX + chartRight) / 2}
            y={16}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={16}
            fontWeight={600}
            fontFamily="sans-serif"
            fill="var(--gm-text, #111)"
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            {layout.title}
          </text>
        )}

        {layout.sections.map((s) => (
          <SectionBandView key={s.id} s={s} selected={viewState.selectedId === s.id} />
        ))}

        {/* axis: gridlines run down the rows, labels sit above the line */}
        {layout.ticks.map((t) => (
          <g key={`${t.x}-${t.label}`} style={{ pointerEvents: "none" }}>
            <line
              x1={t.x}
              y1={layout.axisY}
              x2={t.x}
              y2={layout.rowsBottom}
              stroke="var(--gm-grid, #d7dce3)"
              strokeWidth={1}
            />
            {/* a crowded axis keeps the gridline and drops the date */}
            {t.label !== undefined && (
              <text
                x={t.x}
                y={layout.axisY - 8}
                textAnchor="middle"
                fontSize={11}
                fontFamily="sans-serif"
                fill="var(--gm-muted, #667)"
                style={{ userSelect: "none" }}
              >
                {t.label}
              </text>
            )}
          </g>
        ))}
        <line
          x1={layout.chartX}
          y1={layout.axisY}
          x2={chartRight}
          y2={layout.axisY}
          stroke="var(--gm-stroke, #333)"
          strokeWidth={1}
          style={{ pointerEvents: "none" }}
        />

        {layout.bars.map((b) => (
          <BarView key={b.id} b={b} selected={viewState.selectedId === b.id} />
        ))}

        {layout.verts.map((v) => (
          <VertView key={v.id} v={v} top={layout.axisY} bottom={layout.rowsBottom} selected={viewState.selectedId === v.id} />
        ))}

        {layout.todayX !== undefined && (
          <line
            x1={layout.todayX}
            y1={layout.axisY}
            x2={layout.todayX}
            y2={layout.rowsBottom}
            stroke="var(--gm-today, #d6336c)"
            strokeWidth={2}
            strokeDasharray="4 3"
            style={{ pointerEvents: "none" }}
          />
        )}
      </g>
    </svg>
  );
}

function SectionBandView({ s, selected }: { s: GanttSectionBand; selected: boolean }) {
  const { x, y, w, h } = s.rect;
  return (
    <g data-element-id={s.id} style={{ cursor: "pointer" }}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill={s.index % 2 === 0 ? "var(--gm-band-a, #f2f5f9)" : "var(--gm-band-b, #e8edf4)"}
        stroke={selected ? "var(--gm-selected, #1a73e8)" : "none"}
        strokeWidth={selected ? 2 : 0}
      />
      <text
        x={x + 8}
        y={y + 14}
        fontSize={12}
        fontWeight={600}
        fontFamily="sans-serif"
        fill="var(--gm-text, #333)"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {s.name}
      </text>
    </g>
  );
}

function BarView({ b, selected }: { b: GanttBar; selected: boolean }) {
  const { x, y, w, h } = b.rect;
  const fill = fillOf(b);
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #55606e)";
  const cy = y + h / 2;
  const r = h / 2;
  return (
    <g data-element-id={b.id} style={{ cursor: "pointer" }}>
      {b.milestone ? (
        <polygon
          points={`${x},${cy - r} ${x + r},${cy} ${x},${cy + r} ${x - r},${cy}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={selected ? 2.5 : 1}
          {...(b.unresolved ? { strokeDasharray: "3 2" } : {})}
        />
      ) : (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={3}
          fill={fill}
          fillOpacity={b.unresolved ? 0.45 : 1}
          stroke={stroke}
          strokeWidth={selected ? 2.5 : 1}
          {...(b.unresolved ? { strokeDasharray: "4 3" } : {})}
        />
      )}
      {/* the row label is part of the task's hit target: clicking the name
          selects the task, like clicking its bar */}
      <text
        x={b.labelRect.x + b.labelRect.w - 10}
        y={cy}
        textAnchor="end"
        dominantBaseline="central"
        fontSize={12}
        fontFamily="sans-serif"
        fill="var(--gm-text, #111)"
        style={{ userSelect: "none" }}
      >
        {b.label}
      </text>
    </g>
  );
}

function VertView({ v, top, bottom, selected }: { v: GanttVert; top: number; bottom: number; selected: boolean }) {
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-vert, #7a5195)";
  return (
    <g data-element-id={v.id} style={{ cursor: "pointer" }}>
      {/* a 1px line is unclickable: a transparent fat line carries the hits */}
      <line x1={v.x} y1={top} x2={v.x} y2={bottom} stroke="transparent" strokeWidth={10} />
      <line
        x1={v.x}
        y1={top}
        x2={v.x}
        y2={bottom}
        stroke={stroke}
        strokeWidth={selected ? 2.5 : 1.5}
        strokeDasharray={v.unresolved ? "4 3" : "6 3"}
      />
      <text
        x={v.x + 4}
        y={top + 12}
        fontSize={11}
        fontFamily="sans-serif"
        fill={stroke}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {v.label}
      </text>
    </g>
  );
}
