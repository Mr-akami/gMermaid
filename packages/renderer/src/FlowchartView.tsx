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
        <marker id="gm-circle" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <circle cx="5" cy="5" r="4" fill="var(--gm-node-fill, #fff)" stroke="var(--gm-stroke, #333)" strokeWidth="1.5" />
        </marker>
        <marker id="gm-cross" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 1 1 L 9 9 M 9 1 L 1 9" fill="none" stroke="var(--gm-stroke, #333)" strokeWidth="1.8" />
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

// marker-like shapes mermaid draws without text
const NO_LABEL = new Set(["fork", "smCirc", "fCirc", "crossCirc"]);

/** Rectangle with a wavy bottom edge (document). */
function docPath(x: number, y: number, w: number, h: number): string {
  const wave = Math.min(8, h / 5);
  return `M ${x} ${y} H ${x + w} V ${y + h - wave} q ${-w / 4} ${wave * 1.6} ${-w / 2} 0 q ${-w / 4} ${-wave * 1.6} ${-w / 2} 0 Z`;
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
    case "text":
      // label only, no frame
      shape = null;
      break;
    case "doc":
      shape = <path d={docPath(x, y, w, h)} {...common} />;
      break;
    case "docs": {
      const off = 5;
      shape = (
        <>
          <path d={docPath(x + off * 2, y - off * 2, w - off * 2, h)} {...common} />
          <path d={docPath(x + off, y - off, w - off * 2, h)} {...common} />
          <path d={docPath(x, y, w - off * 2, h)} {...common} />
        </>
      );
      break;
    }
    case "stRect": {
      const off = 5;
      shape = (
        <>
          <rect x={x + off * 2} y={y - off * 2} width={w - off * 2} height={h} {...common} />
          <rect x={x + off} y={y - off} width={w - off * 2} height={h} {...common} />
          <rect x={x} y={y} width={w - off * 2} height={h} {...common} />
        </>
      );
      break;
    }
    case "notchRect": {
      const n = Math.min(14, w / 5);
      shape = poly([[x + n, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y + n]]);
      break;
    }
    case "hourglass":
      shape = <path d={`M ${x} ${y} L ${x + w} ${y} L ${x} ${y + h} L ${x + w} ${y + h} Z`} {...common} />;
      break;
    case "delay": {
      const r = h / 2;
      shape = <path d={`M ${x} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x} Z`} {...common} />;
      break;
    }
    case "fork":
      shape = <rect x={x} y={y} width={w} height={h} fill={stroke} stroke={stroke} />;
      break;
    case "bolt":
      shape = poly([
        [x, y + h],
        [x + w * 0.55, y],
        [x + w * 0.45, y + h * 0.45],
        [x + w, y + h * 0.35],
        [x + w * 0.45, y + h],
      ]);
      break;
    case "tri":
      shape = poly([[x + w / 2, y], [x + w, y + h], [x, y + h]]);
      break;
    case "flipTri":
      shape = poly([[x, y], [x + w, y], [x + w / 2, y + h]]);
      break;
    case "slRect": {
      const s = Math.min(14, h / 3);
      shape = poly([[x, y + s], [x + w, y], [x + w, y + h], [x, y + h]]);
      break;
    }
    case "linCyl": {
      const ry = Math.min(8, h / 4);
      shape = (
        <>
          <path
            d={`M ${x} ${y + ry} A ${w / 2} ${ry} 0 0 1 ${x + w} ${y + ry} V ${y + h - ry} A ${w / 2} ${ry} 0 0 1 ${x} ${y + h - ry} Z M ${x} ${y + ry} A ${w / 2} ${ry} 0 0 0 ${x + w} ${y + ry}`}
            {...common}
          />
          <line x1={x + 8} y1={y + ry * 1.6} x2={x + 8} y2={y + h - ry} stroke={stroke} strokeWidth={1} />
        </>
      );
      break;
    }
    case "fCirc":
      shape = <circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) / 2} fill={stroke} stroke={stroke} />;
      break;
    case "smCirc":
      shape = <circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) / 2} {...common} />;
      break;
    case "crossCirc": {
      const r = Math.min(w, h) / 2;
      const d = r * 0.7;
      shape = (
        <>
          <circle cx={x + w / 2} cy={y + h / 2} r={r} {...common} />
          <path
            d={`M ${x + w / 2 - d} ${y + h / 2 - d} L ${x + w / 2 + d} ${y + h / 2 + d} M ${x + w / 2 + d} ${y + h / 2 - d} L ${x + w / 2 - d} ${y + h / 2 + d}`}
            fill="none"
            stroke={stroke}
            strokeWidth={common.strokeWidth}
          />
        </>
      );
      break;
    }
    case "brace": {
      const c = Math.min(10, w / 4);
      shape = (
        <path
          d={`M ${x + c} ${y} q ${-c} 0 ${-c} ${c} V ${y + h / 2 - c} q 0 ${c} ${-c} ${c} q ${c} 0 ${c} ${c} V ${y + h - c} q 0 ${c} ${c} ${c}`}
          fill="none"
          stroke={stroke}
          strokeWidth={common.strokeWidth}
        />
      );
      break;
    }
    case "linRect":
      shape = (
        <>
          <rect x={x} y={y} width={w} height={h} {...common} />
          <line x1={x + 6} y1={y} x2={x + 6} y2={y + h} stroke={stroke} strokeWidth={1} />
        </>
      );
      break;
    case "divRect":
      shape = (
        <>
          <rect x={x} y={y} width={w} height={h} {...common} />
          <line x1={x} y1={y + 10} x2={x + w} y2={y + 10} stroke={stroke} strokeWidth={1} />
        </>
      );
      break;
    case "winPane":
      shape = (
        <>
          <rect x={x} y={y} width={w} height={h} {...common} />
          <line x1={x + 10} y1={y} x2={x + 10} y2={y + h} stroke={stroke} strokeWidth={1} />
          <line x1={x} y1={y + 10} x2={x + w} y2={y + 10} stroke={stroke} strokeWidth={1} />
        </>
      );
      break;
    case "bowRect": {
      const c = Math.min(12, w / 6);
      shape = (
        <path
          d={`M ${x} ${y} H ${x + w} q ${-c} ${h / 2} 0 ${h} H ${x} q ${c} ${-h / 2} 0 ${-h} Z`}
          {...common}
        />
      );
      break;
    }
    case "curvTrap": {
      const c = Math.min(14, w / 5);
      shape = (
        <path
          d={`M ${x} ${y} H ${x + w - c} q ${c * 1.4} ${h / 2} 0 ${h} H ${x} q ${c} ${-h / 2} 0 ${-h} Z`}
          {...common}
        />
      );
      break;
    }
    case "tagRect": {
      const t = Math.min(14, h / 2);
      shape = (
        <>
          <rect x={x} y={y} width={w} height={h} {...common} />
          <path d={`M ${x} ${y + h - t} L ${x + t} ${y + h} H ${x} Z`} fill={stroke} stroke={stroke} />
        </>
      );
      break;
    }
  }

  return (
    <g data-element-id={node.id} data-drag="connect" style={{ cursor: "pointer" }}>
      {shape}
      {!NO_LABEL.has(node.shape) && (
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
      )}
    </g>
  );
}

const MARKER: Record<string, string | undefined> = {
  none: undefined,
  arrow: "url(#gm-arrow)",
  circle: "url(#gm-circle)",
  cross: "url(#gm-cross)",
};

function EdgeView({ edge, selected }: { edge: EdgePath; selected: boolean }) {
  const d = edge.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #333)";
  // invisible links shape the layout but draw (almost) nothing — a faint
  // dotted trace appears only while selected so the edge stays editable
  const invisible = edge.line === "invisible";
  const dash = edge.line === "dotted" ? "5 4" : invisible ? "2 6" : undefined;
  const base = edge.line === "thick" ? 3.5 : 1.5;
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
        markerStart={invisible ? undefined : MARKER[edge.headStart]}
        markerEnd={invisible ? undefined : MARKER[edge.headEnd]}
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
