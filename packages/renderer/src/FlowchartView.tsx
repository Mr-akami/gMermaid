import { useRef, type PointerEvent, type ReactNode } from "react";
import type { EdgePath, FlowchartLayout, NodeBox } from "@gmermaid/layout";

// The renderer sees layout data (ids + geometry) only — never the IR.
// Hit testing for click/hover is delegated to the DOM via data-element-id.
export interface FlowchartViewState {
  readonly selectedId?: string | undefined;
}

export interface FlowchartViewProps {
  readonly layout: FlowchartLayout;
  readonly viewState: FlowchartViewState;
  readonly onElementClick?: (id: string) => void;
  readonly onBackgroundClick?: () => void;
  /** Dragging from a node = draw a new edge to the drop target. */
  readonly onConnectDrag?: (fromId: string, x: number, y: number) => void;
  readonly onConnectDrop?: (fromId: string, x: number, y: number) => void;
  /** Rubber band for the edge-creation gesture. */
  readonly connectLine?: { x1: number; y1: number; x2: number; y2: number } | undefined;
}

const PADDING = 20;
const DRAG_THRESHOLD = 5;

export function FlowchartView({
  layout,
  viewState,
  onElementClick,
  onBackgroundClick,
  onConnectDrag,
  onConnectDrop,
  connectLine,
}: FlowchartViewProps) {
  // Clicks resolve on pointerup from the original press target: pointer
  // capture retargets native clicks to the svg root (see SequenceView).
  const pointer = useRef<{ targetId: string | null; connect: boolean; sx: number; sy: number; active: boolean } | null>(null);

  function pt(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left - PADDING, y: e.clientY - rect.top - PADDING };
  }

  return (
    <svg
      width={layout.size.w + PADDING * 2}
      height={layout.size.h + PADDING * 2}
      viewBox={`${-PADDING} ${-PADDING} ${layout.size.w + PADDING * 2} ${layout.size.h + PADDING * 2}`}
      onPointerDown={(e: PointerEvent<SVGSVGElement>) => {
        const target = e.target as Element;
        const targetId = target.closest("[data-element-id]")?.getAttribute("data-element-id") ?? null;
        const connect = target.closest("[data-drag='connect']") !== null;
        const { x, y } = pt(e);
        pointer.current = { targetId, connect, sx: x, sy: y, active: false };
        if (connect) e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e: PointerEvent<SVGSVGElement>) => {
        const p = pointer.current;
        if (!p || !p.connect || p.targetId === null) return;
        const { x, y } = pt(e);
        if (!p.active && Math.abs(x - p.sx) < DRAG_THRESHOLD && Math.abs(y - p.sy) < DRAG_THRESHOLD) return;
        p.active = true;
        onConnectDrag?.(p.targetId, x, y);
      }}
      onPointerUp={(e: PointerEvent<SVGSVGElement>) => {
        const p = pointer.current;
        pointer.current = null;
        if (!p) return;
        if (p.active && p.targetId !== null) {
          const { x, y } = pt(e);
          onConnectDrop?.(p.targetId, x, y);
          return;
        }
        if (p.targetId !== null) onElementClick?.(p.targetId);
        else onBackgroundClick?.();
      }}
    >
      <defs>
        <marker id="gm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--gm-stroke, #333)" />
        </marker>
      </defs>
      {layout.edges.map((edge) => (
        <EdgeView key={edge.id} edge={edge} selected={viewState.selectedId === edge.id} />
      ))}
      {layout.nodes.map((node) => (
        <NodeView key={node.id} node={node} selected={viewState.selectedId === node.id} />
      ))}
      {connectLine !== undefined && (
        <line x1={connectLine.x1} y1={connectLine.y1} x2={connectLine.x2} y2={connectLine.y2} stroke="var(--gm-selected, #1a73e8)" strokeWidth={1.5} strokeDasharray="6 4" markerEnd="url(#gm-arrow)" style={{ pointerEvents: "none" }} />
      )}
    </svg>
  );
}

function NodeView({ node, selected }: { node: NodeBox; selected: boolean }) {
  const { x, y, w, h } = node.rect;
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #333)";
  const common = {
    fill: "var(--gm-node-fill, #fff)",
    stroke,
    strokeWidth: selected ? 2.5 : 1.5,
  } as const;

  let shape: ReactNode;
  switch (node.shape) {
    case "rect":
      shape = <rect x={x} y={y} width={w} height={h} {...common} />;
      break;
    case "rounded":
      shape = <rect x={x} y={y} width={w} height={h} rx={8} {...common} />;
      break;
    case "stadium":
      shape = <rect x={x} y={y} width={w} height={h} rx={h / 2} {...common} />;
      break;
    case "diamond":
      shape = (
        <polygon
          points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`}
          {...common}
        />
      );
      break;
    case "circle":
      shape = <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...common} />;
      break;
  }

  return (
    <g data-element-id={node.id} data-drag="connect" style={{ cursor: "pointer" }}>
      {shape}
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
        {node.label}
      </text>
    </g>
  );
}

function EdgeView({ edge, selected }: { edge: EdgePath; selected: boolean }) {
  const d = edge.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #333)";
  const dash = edge.arrow === "dotted" ? "5 4" : undefined;
  const base = edge.arrow === "thick" ? 3.5 : 1.5;
  const width = selected ? base + 1 : base;
  return (
    <g data-element-id={edge.id} style={{ cursor: "pointer" }}>
      {/* wide invisible stroke so thin edges are clickable */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
        strokeDasharray={dash}
        markerEnd={edge.arrow === "open" ? undefined : "url(#gm-arrow)"}
      />
      {edge.label !== undefined && edge.labelPos && (
        <text
          x={edge.labelPos.x}
          y={edge.labelPos.y - 6}
          textAnchor="middle"
          fontSize={12}
          fontFamily="sans-serif"
          fill="var(--gm-text, #111)"
          style={{ paintOrder: "stroke", stroke: "var(--gm-bg, #fff)", strokeWidth: 4, userSelect: "none" }}
        >
          {edge.label}
        </text>
      )}
    </g>
  );
}
