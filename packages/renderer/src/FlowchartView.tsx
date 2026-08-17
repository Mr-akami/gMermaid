import { type ReactNode } from "react";
import type { EdgePath, FlowchartLayout, NodeBox, SubgraphBox } from "@gmermaid/layout";
import { usePointerGestures, type Viewport } from "./usePointerGestures";

// The renderer sees layout data (ids + geometry) only — never the IR.
// Hit testing for click/hover is delegated to the DOM via data-element-id.
export interface FlowchartViewState {
  readonly selectedId?: string | undefined;
}

export interface FlowchartViewProps {
  readonly layout: FlowchartLayout;
  readonly viewState: FlowchartViewState;
  /** Pan/zoom; undefined = default (identity, padding offset). */
  readonly viewport?: Viewport | undefined;
  readonly onViewportChange?: ((v: Viewport) => void) | undefined;
  readonly onElementClick?: (id: string) => void;
  readonly onBackgroundClick?: () => void;
  /** Dragging from a node = draw a new edge to the drop target. */
  readonly onConnectDrag?: (fromId: string, x: number, y: number) => void;
  readonly onConnectDrop?: (fromId: string, x: number, y: number) => void;
  /** Rubber band for the edge-creation gesture. */
  readonly connectLine?: { x1: number; y1: number; x2: number; y2: number } | undefined;
  readonly onGestureCancel?: () => void;
}

const PADDING = 20;

export function FlowchartView({
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
}: FlowchartViewProps) {
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
        <marker id="gm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--gm-stroke, #333)" />
        </marker>
      </defs>
      <g transform={`translate(${g.viewport.x} ${g.viewport.y}) scale(${g.viewport.scale})`}>
        {/* subgraph frames go under everything, outermost first */}
        {[...layout.subgraphs]
          .toSorted((a, b) => a.depth - b.depth)
          .map((s) => (
            <SubgraphView key={s.id} s={s} selected={viewState.selectedId === s.id} />
          ))}
        {layout.edges.map((edge) => (
          <EdgeView key={edge.id} edge={edge} selected={viewState.selectedId === edge.id} />
        ))}
        {layout.nodes.map((node) => (
          <NodeView key={node.id} node={node} selected={viewState.selectedId === node.id} />
        ))}
        {connectLine !== undefined && (
          <line x1={connectLine.x1} y1={connectLine.y1} x2={connectLine.x2} y2={connectLine.y2} stroke="var(--gm-selected, #1a73e8)" strokeWidth={1.5} strokeDasharray="6 4" markerEnd="url(#gm-arrow)" style={{ pointerEvents: "none" }} />
        )}
      </g>
    </svg>
  );
}

function SubgraphView({ s, selected }: { s: SubgraphBox; selected: boolean }) {
  const { x, y, w, h } = s.rect;
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #888)";
  return (
    <g>
      {/* translucent body: visible but never clickable (like sequence fragments) */}
      <rect x={x} y={y} width={w} height={h} rx={6} fill="var(--gm-frag-fill, rgba(120,140,180,0.06))" style={{ pointerEvents: "none" }} />
      {/* border + title are the subgraph's only hit targets; dragging the
       * title draws an edge from the subgraph as a whole */}
      <g data-element-id={s.id} style={{ cursor: "pointer" }}>
        <rect x={x} y={y} width={w} height={h} rx={6} fill="none" stroke={stroke} strokeWidth={selected ? 2 : 1.2} pointerEvents="stroke" />
        <text
          data-drag="connect"
          x={x + 8}
          y={y + 15}
          fontSize={12}
          fontWeight={600}
          fontFamily="sans-serif"
          fill="var(--gm-text, #444)"
          style={{ userSelect: "none" }}
        >
          {s.label}
        </text>
      </g>
    </g>
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

  const slant = Math.min(14, w / 4); // parallelogram/trapezoid slope
  const poly = (pts: [number, number][]) => (
    <polygon points={pts.map(([px, py]) => `${px},${py}`).join(" ")} {...common} />
  );
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
      shape = poly([[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]]);
      break;
    case "circle":
      shape = <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...common} />;
      break;
    case "doubleCircle":
      shape = (
        <>
          <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...common} />
          <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2 - 4} ry={h / 2 - 4} fill="none" stroke={stroke} strokeWidth={common.strokeWidth} />
        </>
      );
      break;
    case "subroutine":
      shape = (
        <>
          <rect x={x} y={y} width={w} height={h} {...common} />
          <line x1={x + 5} y1={y} x2={x + 5} y2={y + h} stroke={stroke} strokeWidth={1} />
          <line x1={x + w - 5} y1={y} x2={x + w - 5} y2={y + h} stroke={stroke} strokeWidth={1} />
        </>
      );
      break;
    case "cylinder": {
      const ry = Math.min(8, h / 4);
      shape = (
        <path
          d={`M ${x} ${y + ry} A ${w / 2} ${ry} 0 0 1 ${x + w} ${y + ry} V ${y + h - ry} A ${w / 2} ${ry} 0 0 1 ${x} ${y + h - ry} Z M ${x} ${y + ry} A ${w / 2} ${ry} 0 0 0 ${x + w} ${y + ry}`}
          {...common}
        />
      );
      break;
    }
    case "hexagon": {
      const c = Math.min(14, w / 4);
      shape = poly([[x + c, y], [x + w - c, y], [x + w, y + h / 2], [x + w - c, y + h], [x + c, y + h], [x, y + h / 2]]);
      break;
    }
    case "asymmetric":
      shape = poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x + slant, y + h / 2]]);
      break;
    case "parallelogram":
      shape = poly([[x + slant, y], [x + w, y], [x + w - slant, y + h], [x, y + h]]);
      break;
    case "parallelogramAlt":
      shape = poly([[x, y], [x + w - slant, y], [x + w, y + h], [x + slant, y + h]]);
      break;
    case "trapezoid":
      shape = poly([[x + slant, y], [x + w - slant, y], [x + w, y + h], [x, y + h]]);
      break;
    case "trapezoidAlt":
      shape = poly([[x, y], [x + w, y], [x + w - slant, y + h], [x + slant, y + h]]);
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
  // invisible links shape the layout but draw (almost) nothing — a faint
  // dotted trace appears only while selected so the edge stays editable
  const invisible = edge.arrow === "invisible";
  const dash = edge.arrow === "dotted" ? "5 4" : invisible ? "2 6" : undefined;
  const base = edge.arrow === "thick" ? 3.5 : 1.5;
  const width = selected ? base + 1 : base;
  return (
    <g data-element-id={edge.id} style={{ cursor: "pointer" }}>
      {/* wide invisible stroke so thin edges are clickable */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
      <path
        d={d}
        fill="none"
        stroke={invisible && !selected ? "transparent" : stroke}
        strokeWidth={width}
        strokeDasharray={dash}
        markerEnd={edge.arrow === "open" || invisible ? undefined : "url(#gm-arrow)"}
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
