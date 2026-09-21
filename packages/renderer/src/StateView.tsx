import type { StateBox, StateLayout, StateNoteBox, TransitionPath } from "@gmermaid/layout";
import { COMPOSITE_TITLE_BAND } from "@gmermaid/layout";
import { edgePath } from "./edgePath";
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
  /** "connect" (default): dragging a state draws a new transition to the drop
   * target. "move": the same gesture reparents the state into the composite
   * under the pointer. One gesture, two meanings — the editor toggles it. */
  readonly dragMode?: "connect" | "move" | undefined;
  /** Dragging from a state = draw a new transition to the drop target. */
  readonly onConnectDrag?: (fromId: string, x: number, y: number) => void;
  readonly onConnectDrop?: (fromId: string, x: number, y: number) => void;
  /** Same gesture in "move" mode: reparent into the drop target. */
  readonly onMoveDrag?: (id: string, x: number, y: number) => void;
  readonly onMoveDrop?: (id: string, x: number, y: number) => void;
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
  dragMode = "connect",
  onConnectDrag,
  onConnectDrop,
  onMoveDrag,
  onMoveDrop,
  connectLine,
  onGestureCancel,
}: StateViewProps) {
  const g = usePointerGestures({
    padding: PADDING,
    viewport,
    onViewportChange,
    dragKinds: [dragMode],
    onElementClick,
    onBackgroundClick,
    onDrag: (kind, id, x, y) => (kind === "move" ? onMoveDrag?.(id, x, y) : onConnectDrag?.(id, x, y)),
    onDrop: (kind, id, x, y) => (kind === "move" ? onMoveDrop?.(id, x, y) : onConnectDrop?.(id, x, y)),
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
      <g transform={`translate(${g.viewport.x} ${g.viewport.y}) scale(${g.viewport.scale})`} data-gm-root="">
        {/* composite frames go under everything, outermost first */}
        {layout.states
          .filter((s) => s.composite)
          .toSorted((a, b) => a.depth - b.depth)
          .map((s) => (
            <CompositeView key={s.id} s={s} selected={viewState.selectedId === s.id} dragMode={dragMode} />
          ))}
        {/* `--` dividers between concurrency regions */}
        {layout.regionSeparators.map((sep, i) => (
          <line
            key={`${sep.parent}-${i}`}
            x1={sep.x1}
            y1={sep.y1}
            x2={sep.x2}
            y2={sep.y2}
            stroke="var(--gm-stroke, #555)"
            strokeWidth={1}
            strokeDasharray="5 4"
            data-region-separator={sep.parent}
            style={{ pointerEvents: "none" }}
          />
        ))}
        {layout.transitions.map((t) => (
          <TransitionView key={t.id} t={t} selected={viewState.selectedId === t.id} />
        ))}
        {layout.states
          .filter((s) => !s.composite)
          .map((s) => (
            <StateBoxView key={s.id} s={s} selected={viewState.selectedId === s.id} dragMode={dragMode} />
          ))}
        {layout.notes.map((n) => (
          <g key={n.id} data-element-id={n.id} style={{ cursor: "pointer" }}>
            <line x1={n.anchor.x1} y1={n.anchor.y1} x2={n.anchor.x2} y2={n.anchor.y2} stroke="var(--gm-note-line, #b59a2e)" strokeWidth={1} strokeDasharray="3 3" style={{ pointerEvents: "none" }} />
            <rect x={n.rect.x} y={n.rect.y} width={n.rect.w} height={n.rect.h} rx={3} fill="var(--gm-note-fill, #fdf6d3)" stroke="var(--gm-note-stroke, #c8b25a)" strokeWidth={1} />
            <NoteText n={n} />
          </g>
        ))}
        {connectLine !== undefined && (
          <line x1={connectLine.x1} y1={connectLine.y1} x2={connectLine.x2} y2={connectLine.y2} stroke="var(--gm-selected, #1a73e8)" strokeWidth={1.5} strokeDasharray="6 4" markerEnd="url(#gm-state-arrow)" style={{ pointerEvents: "none" }} />
        )}
      </g>
    </svg>
  );
}

/** One `<tspan>` per line: layout already sized the box for the line count. */
function NoteText({ n }: { n: StateNoteBox }) {
  const lines = n.text.split("\n");
  const lineH = 14;
  const first = n.rect.y + n.rect.h / 2 - ((lines.length - 1) * lineH) / 2;
  return (
    <text
      x={n.rect.x + n.rect.w / 2}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={12}
      fontFamily="sans-serif"
      fill="var(--gm-text, #333)"
      style={{ pointerEvents: "none", userSelect: "none" }}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={n.rect.x + n.rect.w / 2} y={first + i * lineH}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function CompositeView({ s, selected, dragMode }: { s: StateBox; selected: boolean; dragMode: "connect" | "move" }) {
  const { x, y, w, h } = s.rect;
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #555)";
  return (
    <g>
      {/* translucent body: visible but never clickable (like sequence fragments) */}
      <rect x={x} y={y} width={w} height={h} rx={8} fill="var(--gm-frag-fill, rgba(120,140,180,0.06))" style={{ pointerEvents: "none" }} />
      {/* border + title bar are the composite's only hit targets */}
      <g data-element-id={s.id} style={{ cursor: "pointer" }}>
        <rect x={x} y={y} width={w} height={h} rx={8} fill="none" stroke={stroke} strokeWidth={selected ? 2 : 1.2} pointerEvents="stroke" />
        <line x1={x} y1={y + COMPOSITE_TITLE_BAND} x2={x + w} y2={y + COMPOSITE_TITLE_BAND} stroke={stroke} strokeWidth={1} style={{ pointerEvents: "none" }} />
        <text
          data-drag={dragMode}
          x={x + 10}
          y={y + COMPOSITE_TITLE_BAND - 8}
          fontSize={12}
          fontWeight={600}
          fontFamily="sans-serif"
          fill="var(--gm-text, #333)"
          style={{ userSelect: "none" }}
        >
          {s.label}
        </text>
      </g>
    </g>
  );
}

function StateBoxView({ s, selected, dragMode }: { s: StateBox; selected: boolean; dragMode: "connect" | "move" }) {
  const { x, y, w, h } = s.rect;
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #333)";
  if (s.role === "start" || s.role === "end") {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.min(w, h) / 2;
    return (
      <g data-element-id={s.id} data-drag={dragMode} style={{ cursor: "pointer" }}>
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
  if (s.role === "choice") {
    const cx = x + w / 2;
    const cy = y + h / 2;
    return (
      <g data-element-id={s.id} data-drag={dragMode} style={{ cursor: "pointer" }}>
        <polygon
          points={`${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`}
          fill="var(--gm-node-fill, #fff)"
          stroke={stroke}
          strokeWidth={selected ? 2.5 : 1.4}
        />
      </g>
    );
  }
  if (s.role === "fork" || s.role === "join") {
    return (
      <g data-element-id={s.id} data-drag={dragMode} style={{ cursor: "pointer" }}>
        <rect x={x} y={y} width={w} height={h} rx={3} fill="var(--gm-stroke, #333)" stroke={stroke} strokeWidth={selected ? 2 : 0} />
      </g>
    );
  }
  return (
    <g data-element-id={s.id} data-drag={dragMode} style={{ cursor: "pointer" }}>
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
  const d = edgePath(t.points);
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
