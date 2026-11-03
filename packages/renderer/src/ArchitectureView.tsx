import type { ReactElement } from "react";
import type { ArchEdgePath, ArchGroupFrame, ArchJunctionDot, ArchServiceBox, ArchitectureLayout } from "@gmermaid/layout";
import { edgePath } from "./edgePath";
import { usePointerGestures, type Viewport, type SelectionGestures } from "./usePointerGestures";
import { MarqueeRect, selectionOf } from "./Marquee";

export interface ArchitectureViewState {
  readonly selectedId?: string | undefined;
  /** The whole selection; `selectedId` is always one of these. */
  readonly selectedIds?: readonly string[] | undefined;
}

export interface ArchitectureViewProps {
  readonly layout: ArchitectureLayout;
  readonly viewState: ArchitectureViewState;
  /** Pan/zoom; undefined = default (identity, padding offset). */
  readonly viewport?: Viewport | undefined;
  readonly onViewportChange?: ((v: Viewport) => void) | undefined;
  /** `additive` = Ctrl/Cmd/Shift was held: add to the selection. */
  readonly onElementClick?: (id: string, additive: boolean) => void;
  readonly onBackgroundClick?: () => void;
  /** Marquee and context-menu gestures (see SelectionGestures). */
  readonly select?: SelectionGestures | undefined;
  /** Dragging from a service / junction = draw a new edge to the drop target. */
  readonly onConnectDrag?: (fromId: string, x: number, y: number) => void;
  readonly onConnectDrop?: (fromId: string, x: number, y: number) => void;
  readonly connectLine?: { x1: number; y1: number; x2: number; y2: number } | undefined;
  readonly onGestureCancel?: () => void;
}

const PADDING = 20;
const STROKE = "var(--gm-stroke, #333)";
const SELECTED = "var(--gm-selected, #1a73e8)";

export function ArchitectureView({
  layout,
  viewState,
  viewport,
  onViewportChange,
  onElementClick,
  onBackgroundClick,
  select,
  onConnectDrag,
  onConnectDrop,
  connectLine,
  onGestureCancel,
}: ArchitectureViewProps) {
  const sel = selectionOf(viewState);
  const g = usePointerGestures({
    padding: PADDING,
    viewport,
    onViewportChange,
    dragKinds: ["connect"],
    onElementClick,
    onBackgroundClick,
    selection: select,
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
      onContextMenu={g.onContextMenu}
      style={g.style}
    >
      <defs>
        {/* a filled arrowhead, as mermaid draws architecture edges */}
        <marker id="gm-arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={STROKE} />
        </marker>
        <marker id="gm-arch-arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={SELECTED} />
        </marker>
      </defs>

      <g transform={`translate(${g.viewport.x} ${g.viewport.y}) scale(${g.viewport.scale})`} data-gm-root="">
        {/* frames go under everything they contain; layout lists parents first */}
        {layout.groups.map((f) => (
          <GroupView key={f.id} f={f} selected={sel.has(f.id)} />
        ))}
        {layout.edges.map((e) => (
          <EdgeView key={e.id} e={e} selected={sel.has(e.id)} />
        ))}
        {layout.services.map((s) => (
          <ServiceView key={s.id} s={s} selected={sel.has(s.id)} />
        ))}
        {layout.junctions.map((j) => (
          <JunctionView key={j.id} j={j} selected={sel.has(j.id)} />
        ))}
        {connectLine !== undefined && (
          <line
            x1={connectLine.x1}
            y1={connectLine.y1}
            x2={connectLine.x2}
            y2={connectLine.y2}
            stroke={SELECTED}
            strokeWidth={1.5}
            strokeDasharray="6 4"
            style={{ pointerEvents: "none" }}
          />
        )}
      </g>
      {g.band !== undefined && (
        <g transform={`translate(${g.viewport.x} ${g.viewport.y}) scale(${g.viewport.scale})`}>
          <MarqueeRect band={g.band} />
        </g>
      )}
    </svg>
  );
}

/** Mermaid's five built-in icons, drawn as simple glyphs in a 24x24 box.
 * Any other name needs an icon pack the editor does not have, so it gets its
 * own name as a caption on a plain tile. */
function Glyph({ icon, x, y, size, color }: { icon: string | undefined; x: number; y: number; size: number; color: string }) {
  const s = size / 24;
  const common = { fill: "none", stroke: color, strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  let body: ReactElement;
  switch (icon) {
    case "cloud":
      body = <path d="M6.5 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.4 8.5 4.8 4.8 0 0 1 17.5 18z" {...common} />;
      break;
    case "database":
      body = (
        <g {...common}>
          <ellipse cx="12" cy="6" rx="7" ry="3" />
          <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
        </g>
      );
      break;
    case "disk":
      body = (
        <g {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="12" cy="12" r="0.8" fill={color} />
        </g>
      );
      break;
    case "internet":
      body = (
        <g {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17M12 3.5c2.5 2.4 3.6 5.3 3.6 8.5s-1.1 6.1-3.6 8.5c-2.5-2.4-3.6-5.3-3.6-8.5S9.5 5.9 12 3.5z" />
        </g>
      );
      break;
    case "server":
      body = (
        <g {...common}>
          <rect x="4" y="4" width="16" height="7" rx="1.5" />
          <rect x="4" y="13" width="16" height="7" rx="1.5" />
          <path d="M7.5 7.5h.01M7.5 16.5h.01" strokeWidth={2.4} />
        </g>
      );
      break;
    default:
      body =
        icon === undefined ? (
          <rect x="5" y="5" width="14" height="14" rx="2" {...common} />
        ) : (
          <text x="12" y="16" textAnchor="middle" fontSize="9" fontFamily="sans-serif" fill={color} stroke="none">
            {icon.includes(":") ? icon.split(":")[1]!.slice(0, 4) : icon.slice(0, 4)}
          </text>
        );
  }
  return <g transform={`translate(${x} ${y}) scale(${s})`}>{body}</g>;
}

function ServiceView({ s, selected }: { s: ArchServiceBox; selected: boolean }) {
  const stroke = selected ? SELECTED : STROKE;
  const { x, y, w, h } = s.rect;
  const i = s.iconRect;
  return (
    <g data-element-id={s.id} data-drag="connect" style={{ cursor: "pointer" }}>
      {/* an invisible pad makes the label clickable too */}
      <rect x={x} y={y} width={w} height={h} fill="transparent" />
      <rect x={i.x} y={i.y} width={i.w} height={i.h} rx={10} fill="var(--gm-node-fill, #fff)" stroke={stroke} strokeWidth={selected ? 2.5 : 1.4} />
      <Glyph icon={s.icon} x={i.x + 12} y={i.y + 12} size={40} color={stroke} />
      <text
        x={x + w / 2}
        y={i.y + i.h + 15}
        textAnchor="middle"
        fontSize={13}
        fontFamily="sans-serif"
        fill="var(--gm-text, #111)"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {s.label}
      </text>
    </g>
  );
}

function JunctionView({ j, selected }: { j: ArchJunctionDot; selected: boolean }) {
  const { x, y, w, h } = j.rect;
  return (
    <g data-element-id={j.id} data-drag="connect" style={{ cursor: "pointer" }}>
      {/* a bigger hit area than the dot */}
      <circle cx={x + w / 2} cy={y + h / 2} r={Math.max(w, h)} fill="transparent" />
      <circle cx={x + w / 2} cy={y + h / 2} r={w / 2} fill={selected ? SELECTED : STROKE} />
    </g>
  );
}

function GroupView({ f, selected }: { f: ArchGroupFrame; selected: boolean }) {
  const { x, y, w, h } = f.rect;
  const stroke = selected ? SELECTED : "var(--gm-stroke, #666)";
  return (
    <g>
      {/* translucent body: visible but never clickable, so members stay reachable */}
      <rect x={x} y={y} width={w} height={h} rx={10} fill="var(--gm-frag-fill, rgba(120,140,180,0.06))" style={{ pointerEvents: "none" }} />
      <g data-element-id={f.id} style={{ cursor: "pointer" }}>
        <rect x={x} y={y} width={w} height={h} rx={10} fill="none" stroke={stroke} strokeWidth={selected ? 2 : 1.2} strokeDasharray="7 4" pointerEvents="stroke" />
        {/* the title band is a hit area of its own */}
        <rect x={x} y={y} width={w} height={26} fill="transparent" />
        {f.icon !== undefined && <Glyph icon={f.icon} x={x + 8} y={y + 4} size={18} color={stroke} />}
        <text
          x={x + (f.icon !== undefined ? 30 : 10)}
          y={y + 18}
          fontSize={12}
          fontWeight={600}
          fontFamily="sans-serif"
          fill="var(--gm-text, #333)"
          style={{ userSelect: "none" }}
        >
          {f.label}
        </text>
      </g>
    </g>
  );
}

function EdgeView({ e, selected }: { e: ArchEdgePath; selected: boolean }) {
  const d = edgePath(e.points);
  const stroke = selected ? SELECTED : STROKE;
  const marker = selected ? "url(#gm-arch-arrow-sel)" : "url(#gm-arch-arrow)";
  return (
    <g data-element-id={e.id} style={{ cursor: "pointer" }}>
      <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={selected ? 2.8 : 2}
        markerStart={e.arrowFrom ? marker : undefined}
        markerEnd={e.arrowTo ? marker : undefined}
      />
      {e.label !== undefined && e.labelPos && (
        <text
          x={e.labelPos.x}
          y={e.labelPos.y}
          textAnchor="middle"
          fontSize={11}
          fontFamily="sans-serif"
          fill="var(--gm-text, #111)"
          style={{ paintOrder: "stroke", stroke: "var(--gm-bg, #fff)", strokeWidth: 4, userSelect: "none" }}
        >
          {e.label}
        </text>
      )}
    </g>
  );
}
