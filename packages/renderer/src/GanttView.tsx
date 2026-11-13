import type { GanttBar, GanttLayout, GanttSectionBand, GanttVert } from "@gmermaid/layout";
import { usePointerGestures, type Viewport , type SelectionGestures } from "./usePointerGestures";
import { MarqueeRect, selectionOf } from "./Marquee";

export interface GanttViewState {
  readonly selectedId?: string | undefined;
  /** The whole selection; `selectedId` is always one of these. */
  readonly selectedIds?: readonly string[] | undefined;
}

export interface GanttViewProps {
  readonly layout: GanttLayout;
  readonly viewState: GanttViewState;
  /** Pan/zoom; undefined = default (identity, padding offset). */
  readonly viewport?: Viewport | undefined;
  readonly onViewportChange?: ((v: Viewport) => void) | undefined;
  /** `additive` = Ctrl/Cmd/Shift was held: add to the selection. */
  readonly onElementClick?: (id: string, additive: boolean) => void;
  readonly onBackgroundClick?: () => void;
  /** Marquee and context-menu gestures (see SelectionGestures). */
  readonly select?: SelectionGestures | undefined;
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

/** Date labels sit above the axis line; this band holds both. */
const AXIS_HEADER_H = 22;

/** Diagram-space shift that keeps the date axis at the canvas top once it has
 * scrolled above it; undefined while it is on screen or the rows are gone. */
export function pinnedAxisDy(layout: GanttLayout, viewport: Viewport): number | undefined {
  const headerTop = layout.axisY - AXIS_HEADER_H;
  const y = Math.min(-viewport.y / viewport.scale, layout.rowsBottom - AXIS_HEADER_H);
  return y > headerTop ? y - headerTop : undefined;
}

function AxisHeader({ layout }: { layout: GanttLayout }) {
  return (
    <g style={{ pointerEvents: "none" }}>
      {/* a crowded axis keeps the gridline and drops the date */}
      {layout.ticks.map(
        (t) =>
          t.label !== undefined && (
            <text
              key={`${t.x}-${t.label}`}
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
          ),
      )}
      <line
        x1={layout.chartX}
        y1={layout.axisY}
        x2={layout.chartX + layout.chartW}
        y2={layout.axisY}
        stroke="var(--gm-stroke, #333)"
        strokeWidth={1}
      />
    </g>
  );
}

export function GanttView({
  layout,
  viewState,
  viewport,
  onViewportChange,
  onElementClick,
  onBackgroundClick,
  select,
}: GanttViewProps) {
  const sel = selectionOf(viewState);
  const g = usePointerGestures({
    padding: PADDING,
    viewport,
    onViewportChange,
    dragKinds: [],
    onElementClick,
    onBackgroundClick,
    selection: select,
  });

  const chartRight = layout.chartX + layout.chartW;
  const pinnedDy = pinnedAxisDy(layout, g.viewport);

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
          <SectionBandView key={s.id} s={s} selected={sel.has(s.id)} />
        ))}

        {layout.ticks.map((t) => (
          <line
            key={`${t.x}-${t.label}`}
            x1={t.x}
            y1={layout.axisY}
            x2={t.x}
            y2={layout.rowsBottom}
            stroke="var(--gm-grid, #d7dce3)"
            strokeWidth={1}
            style={{ pointerEvents: "none" }}
          />
        ))}
        <AxisHeader layout={layout} />

        {layout.bars.map((b) => (
          <BarView key={b.id} b={b} selected={sel.has(b.id)} />
        ))}

        {layout.verts.map((v) => (
          <VertView key={v.id} v={v} top={layout.axisY} bottom={layout.rowsBottom} selected={sel.has(v.id)} />
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
      {/* outside data-gm-root so export never bakes in a scroll position */}
      {pinnedDy !== undefined && (
        <g transform={`translate(${g.viewport.x} ${g.viewport.y}) scale(${g.viewport.scale})`} data-gm-pinned-axis="">
          <g transform={`translate(0 ${pinnedDy})`}>
            <rect
              x={0}
              y={layout.axisY - AXIS_HEADER_H}
              width={layout.size.w}
              height={AXIS_HEADER_H}
              fill="var(--gm-bg, #fff)"
              opacity={0.85}
              style={{ pointerEvents: "none" }}
            />
            <AxisHeader layout={layout} />
          </g>
        </g>
      )}
      {g.band !== undefined && (
        <g transform={`translate(${g.viewport.x} ${g.viewport.y}) scale(${g.viewport.scale})`}>
          <MarqueeRect band={g.band} />
        </g>
      )}
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
