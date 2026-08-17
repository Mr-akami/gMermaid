import type { StateBox, StateLayout, TransitionPath } from "@gmermaid/layout";
import { usePointerGestures, type Viewport } from "./usePointerGestures";

export interface StateViewState {
  readonly selectedId?: string | undefined;
}

export interface StateViewProps {
  readonly layout: StateLayout;
  readonly viewState: StateViewState;
  /** Pan/zoom; undefined = default (identity, padding offset). */
  readonly viewport?: Viewport | undefined;
  readonly onViewportChange?: ((v: Viewport) => void) | undefined;
  readonly onElementClick?: (id: string) => void;
  readonly onBackgroundClick?: () => void;
  /** Dragging from a state = draw a new transition to the drop target. */
  readonly onConnectDrag?: (fromId: string, x: number, y: number) => void;
  readonly onConnectDrop?: (fromId: string, x: number, y: number) => void;
  readonly connectLine?: { x1: number; y1: number; x2: number; y2: number } | undefined;
  readonly onGestureCancel?: () => void;
}

const PADDING = 20;

export function StateView({
  layout,
  viewState,
  viewport,
  onViewportChange,
  onElementClick,
  onBackgroundClick,
  onConnectDrag,
  onConnectDrop,
  connectLine,
  onGestureCancel,
}: StateViewProps) {
  const g = usePointerGestures({
    padding: PADDING,
    viewport,
    onViewportChange,
    dragKinds: ["connect"],
    onElementClick,
    onBackgroundClick,
    onDrag: (_kind, id, x, y) => onConnectDrag?.(id, x, y),
    onDrop: (_kind, id, x, y) => onConnectDrop?.(id, x, y),
    onGestureCancel,
  });

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
      <defs>
        <marker id="gm-state-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--gm-stroke, #333)" />
        </marker>
      </defs>
      <g transform={`translate(${g.viewport.x} ${g.viewport.y}) scale(${g.viewport.scale})`}>
        {layout.transitions.map((t) => (
          <TransitionView key={t.id} t={t} selected={viewState.selectedId === t.id} />
        ))}
        {layout.states.map((s) => (
          <StateBoxView key={s.id} s={s} selected={viewState.selectedId === s.id} />
        ))}
        {connectLine !== undefined && (
          <line x1={connectLine.x1} y1={connectLine.y1} x2={connectLine.x2} y2={connectLine.y2} stroke="var(--gm-selected, #1a73e8)" strokeWidth={1.5} strokeDasharray="6 4" markerEnd="url(#gm-state-arrow)" style={{ pointerEvents: "none" }} />
        )}
      </g>
    </svg>
  );
}

function StateBoxView({ s, selected }: { s: StateBox; selected: boolean }) {
  const { x, y, w, h } = s.rect;
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #333)";
  if (s.role !== "normal") {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.min(w, h) / 2;
    return (
      <g data-element-id={s.id} data-drag="connect" style={{ cursor: "pointer" }}>
        {/* start = filled dot, end = bullseye */}
        {s.role === "start" ? (
          <circle cx={cx} cy={cy} r={r} fill="var(--gm-stroke, #333)" stroke={stroke} strokeWidth={selected ? 2.5 : 0} />
        ) : (
          <>
            <circle cx={cx} cy={cy} r={r} fill="var(--gm-bg, #fff)" stroke={stroke} strokeWidth={selected ? 2.5 : 1.4} />
            <circle cx={cx} cy={cy} r={r - 3.5} fill="var(--gm-stroke, #333)" style={{ pointerEvents: "none" }} />
          </>
        )}
      </g>
    );
  }
  return (
    <g data-element-id={s.id} data-drag="connect" style={{ cursor: "pointer" }}>
      <rect x={x} y={y} width={w} height={h} rx={8} fill="var(--gm-node-fill, #fff)" stroke={stroke} strokeWidth={selected ? 2.5 : 1.4} />
      <text
        x={x + w / 2}
        y={y + h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={14}
        fontFamily="sans-serif"
        fill="var(--gm-text, #111)"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {s.label}
      </text>
    </g>
  );
}

function TransitionView({ t, selected }: { t: TransitionPath; selected: boolean }) {
  const d = t.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #333)";
  return (
    <g data-element-id={t.id} style={{ cursor: "pointer" }}>
      <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
      <path d={d} fill="none" stroke={stroke} strokeWidth={selected ? 2.4 : 1.4} markerEnd="url(#gm-state-arrow)" />
      {t.label !== undefined && t.labelPos && (
        <text x={t.labelPos.x} y={t.labelPos.y} textAnchor="middle" fontSize={12} fontFamily="sans-serif" fill="var(--gm-text, #111)" style={{ paintOrder: "stroke", stroke: "var(--gm-bg, #fff)", strokeWidth: 4, userSelect: "none" }}>
          {t.label}
        </text>
      )}
    </g>
  );
}
