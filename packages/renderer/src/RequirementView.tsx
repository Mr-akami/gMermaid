import type { RequirementBox, RequirementEdge, RequirementLayout } from "@gmermaid/layout";
import { edgePath } from "./edgePath";
import { usePointerGestures, type Viewport } from "./usePointerGestures";

export interface RequirementViewState {
  readonly selectedId?: string | undefined;
}

export interface RequirementViewProps {
  readonly layout: RequirementLayout;
  readonly viewState: RequirementViewState;
  /** Pan/zoom; undefined = default (identity, padding offset). */
  readonly viewport?: Viewport | undefined;
  readonly onViewportChange?: ((v: Viewport) => void) | undefined;
  readonly onElementClick?: (id: string) => void;
  readonly onBackgroundClick?: () => void;
  /** Dragging from a box = draw a new relation to the drop target. */
  readonly onConnectDrag?: (fromId: string, x: number, y: number) => void;
  readonly onConnectDrop?: (fromId: string, x: number, y: number) => void;
  readonly connectLine?: { x1: number; y1: number; x2: number; y2: number } | undefined;
  readonly onGestureCancel?: () => void;
}

const PADDING = 20;
const LINE_H = 18;

export function RequirementView({
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
}: RequirementViewProps) {
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
        {/* every requirement relation draws the same open arrowhead; the
            relation type is carried by the `«…»` label, as mermaid does */}
        <marker id="gm-req-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="var(--gm-stroke, #333)" strokeWidth={1.5} />
        </marker>
      </defs>

      <g transform={`translate(${g.viewport.x} ${g.viewport.y}) scale(${g.viewport.scale})`} data-gm-root="">
        {layout.edges.map((e) => (
          <RequirementEdgeView key={e.id} e={e} selected={viewState.selectedId === e.id} />
        ))}
        {layout.boxes.map((b) => (
          <RequirementBoxView key={b.id} b={b} selected={viewState.selectedId === b.id} />
        ))}
        {connectLine !== undefined && (
          <line
            x1={connectLine.x1}
            y1={connectLine.y1}
            x2={connectLine.x2}
            y2={connectLine.y2}
            stroke="var(--gm-selected, #1a73e8)"
            strokeWidth={1.5}
            strokeDasharray="6 4"
            markerEnd="url(#gm-req-open)"
            style={{ pointerEvents: "none" }}
          />
        )}
      </g>
    </svg>
  );
}

function RequirementBoxView({ b, selected }: { b: RequirementBox; selected: boolean }) {
  const { x, y, w, h } = b.rect;
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #333)";
  return (
    <g data-element-id={b.id} data-drag="connect" style={{ cursor: "pointer" }}>
      <rect x={x} y={y} width={w} height={h} rx={4} fill="var(--gm-node-fill, #fff)" stroke={stroke} strokeWidth={selected ? 2.5 : 1.4} />
      <line x1={x} y1={b.headerBottom} x2={x + w} y2={b.headerBottom} stroke={stroke} strokeWidth={1} />
      <text x={x + w / 2} y={y + 16} textAnchor="middle" fontSize={12} fontFamily="sans-serif" fill="var(--gm-text, #555)" style={{ userSelect: "none" }}>
        {b.stereotype}
      </text>
      <text x={x + w / 2} y={y + 16 + LINE_H} textAnchor="middle" fontSize={14} fontWeight={700} fontFamily="sans-serif" fill="var(--gm-text, #111)" style={{ userSelect: "none" }}>
        {b.name}
      </text>
      {b.lines.map((line, i) => (
        <text key={i} x={x + 10} y={b.headerBottom + 10 + (i + 0.7) * LINE_H} fontSize={12} fontFamily="sans-serif" fill="var(--gm-text, #222)" style={{ userSelect: "none" }}>
          {line}
        </text>
      ))}
    </g>
  );
}

function RequirementEdgeView({ e, selected }: { e: RequirementEdge; selected: boolean }) {
  const d = edgePath(e.points);
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #333)";
  return (
    <g data-element-id={e.id} style={{ cursor: "pointer" }}>
      {/* fat transparent stroke: the hit area for a 1.4px line */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
      <path d={d} fill="none" stroke={stroke} strokeWidth={selected ? 2.4 : 1.4} strokeDasharray="6 4" markerEnd="url(#gm-req-open)" />
      <text
        x={e.labelPos.x}
        y={e.labelPos.y}
        textAnchor="middle"
        fontSize={12}
        fontFamily="sans-serif"
        fill="var(--gm-text, #111)"
        style={{ paintOrder: "stroke", stroke: "var(--gm-bg, #fff)", strokeWidth: 4, userSelect: "none" }}
      >
        {e.label}
      </text>
    </g>
  );
}
