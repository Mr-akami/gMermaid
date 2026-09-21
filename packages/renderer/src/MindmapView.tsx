import type { MindmapBranch, MindmapLayout, MindmapNodeBox } from "@gmermaid/layout";
import { usePointerGestures, type Viewport } from "./usePointerGestures";

export interface MindmapViewState {
  readonly selectedId?: string | undefined;
}

export interface MindmapViewProps {
  readonly layout: MindmapLayout;
  readonly viewState: MindmapViewState;
  /** Pan/zoom; undefined = default (identity, padding offset). */
  readonly viewport?: Viewport | undefined;
  readonly onViewportChange?: ((v: Viewport) => void) | undefined;
  readonly onElementClick?: (id: string) => void;
  readonly onBackgroundClick?: () => void;
  /** Dragging a node onto another one re-parents it. */
  readonly onConnectDrag?: (fromId: string, x: number, y: number) => void;
  readonly onConnectDrop?: (fromId: string, x: number, y: number) => void;
  readonly connectLine?: { x1: number; y1: number; x2: number; y2: number } | undefined;
  readonly onGestureCancel?: () => void;
}

const PADDING = 20;

// Depth gives the fill, the way mermaid tints a mindmap by level.
const PALETTE = ["#4f82c4", "#5aab72", "#c98a3d", "#a06fbf", "#4aa3a8", "#c4636c"] as const;
const hue = (depth: number): string => PALETTE[depth % PALETTE.length]!;

export function MindmapView({
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
}: MindmapViewProps) {
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
      <g transform={`translate(${g.viewport.x} ${g.viewport.y}) scale(${g.viewport.scale})`}>
        {layout.branches.map((b) => (
          <BranchView key={b.id} branch={b} depth={layout.nodes.find((n) => n.id === b.to)?.depth ?? 1} />
        ))}
        {layout.nodes.map((n) => (
          <NodeView key={n.id} node={n} selected={viewState.selectedId === n.id} />
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
            style={{ pointerEvents: "none" }}
          />
        )}
      </g>
    </svg>
  );
}

function BranchView({ branch, depth }: { branch: MindmapBranch; depth: number }) {
  const [p0, c1, c2, p3] = branch.points;
  if (!p0 || !c1 || !c2 || !p3) return null;
  return (
    <path
      d={`M ${p0.x} ${p0.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p3.x} ${p3.y}`}
      fill="none"
      stroke={hue(depth)}
      strokeWidth={2}
      strokeOpacity={0.7}
      style={{ pointerEvents: "none" }}
    />
  );
}

/** A jagged "bang" outline: alternating spikes around the box. */
function bangPoints(r: { x: number; y: number; w: number; h: number }): string {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const rx = r.w / 2;
  const ry = r.h / 2;
  const spikes = 16;
  const pts: string[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const a = (Math.PI * i) / spikes;
    const f = i % 2 === 0 ? 1 : 0.82;
    pts.push(`${(cx + Math.cos(a) * rx * f).toFixed(2)},${(cy + Math.sin(a) * ry * f).toFixed(2)}`);
  }
  return pts.join(" ");
}

/** A scalloped cloud outline: arcs around the box. */
function cloudPath(r: { x: number; y: number; w: number; h: number }): string {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const rx = r.w / 2;
  const ry = r.h / 2;
  const bumps = 12;
  const at = (i: number, f: number) => {
    const a = (Math.PI * 2 * i) / bumps;
    return { x: cx + Math.cos(a) * rx * f, y: cy + Math.sin(a) * ry * f };
  };
  const start = at(0, 1);
  let d = `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`;
  for (let i = 1; i <= bumps; i++) {
    const p = at(i, 1);
    const mid = at(i - 0.5, 1.22);
    d += ` Q ${mid.x.toFixed(2)} ${mid.y.toFixed(2)} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }
  return `${d} Z`;
}

function NodeView({ node, selected }: { node: MindmapNodeBox; selected: boolean }) {
  const { x, y, w, h } = node.rect;
  const fill = hue(node.depth);
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : fill;
  const sw = selected ? 2.5 : 1.6;
  const shared = { fill, fillOpacity: 0.22, stroke, strokeWidth: sw };

  return (
    <g data-element-id={node.id} data-drag="connect" style={{ cursor: "pointer" }}>
      {node.shape === "square" && <rect x={x} y={y} width={w} height={h} {...shared} />}
      {node.shape === "rounded" && <rect x={x} y={y} width={w} height={h} rx={h / 2} {...shared} />}
      {node.shape === "circle" && <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...shared} />}
      {node.shape === "hexagon" && (
        <polygon
          points={`${x + h / 3},${y} ${x + w - h / 3},${y} ${x + w},${y + h / 2} ${x + w - h / 3},${y + h} ${x + h / 3},${y + h} ${x},${y + h / 2}`}
          {...shared}
        />
      )}
      {node.shape === "bang" && <polygon points={bangPoints(node.rect)} {...shared} />}
      {node.shape === "cloud" && <path d={cloudPath(node.rect)} {...shared} />}
      {node.shape === "default" && (
        <>
          {/* the default shape is text on a baseline; keep a hit area behind it */}
          <rect x={x} y={y} width={w} height={h} fill="transparent" stroke="none" />
          <line x1={x} y1={y + h} x2={x + w} y2={y + h} stroke={stroke} strokeWidth={sw} />
        </>
      )}
      <Label rect={node.rect} text={node.label} fontSize={node.depth === 0 ? 16 : 14} bold={node.depth === 0} />
      {node.icon !== undefined && (
        <text
          x={x + w / 2}
          y={y - 4}
          textAnchor="middle"
          fontSize={10}
          fontFamily="sans-serif"
          fill="var(--gm-text, #555)"
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          {node.icon}
        </text>
      )}
    </g>
  );
}

/** Centred, `<br/>`-aware label: one tspan per line. */
function Label({
  rect,
  text,
  fontSize,
  bold,
}: {
  rect: { x: number; y: number; w: number; h: number };
  text: string;
  fontSize: number;
  bold: boolean;
}) {
  const rows = text.split("\n");
  const lineH = fontSize * 1.4;
  const cx = rect.x + rect.w / 2;
  const top = rect.y + rect.h / 2 - ((rows.length - 1) * lineH) / 2;
  return (
    <text
      x={cx}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={fontSize}
      fontWeight={bold ? 700 : 400}
      fontFamily="sans-serif"
      fill="var(--gm-text, #111)"
      style={{ pointerEvents: "none", userSelect: "none" }}
    >
      {rows.map((row, i) => (
        <tspan key={i} x={cx} y={top + i * lineH}>
          {row}
        </tspan>
      ))}
    </text>
  );
}
