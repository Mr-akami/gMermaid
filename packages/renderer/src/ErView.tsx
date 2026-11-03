import type { ErEdge, ErEntityBox, ErLayout } from "@gmermaid/layout";
import type { ErCardinality } from "@gmermaid/ir";
import { edgePath } from "./edgePath";
import { usePointerGestures, type Viewport, type SelectionGestures } from "./usePointerGestures";
import { MarqueeRect, selectionOf } from "./Marquee";

export interface ErViewState {
  readonly selectedId?: string | undefined;
  /** The whole selection; `selectedId` is always one of these. */
  readonly selectedIds?: readonly string[] | undefined;
}

export interface ErViewProps {
  readonly layout: ErLayout;
  readonly viewState: ErViewState;
  /** Pan/zoom; undefined = default (identity, padding offset). */
  readonly viewport?: Viewport | undefined;
  readonly onViewportChange?: ((v: Viewport) => void) | undefined;
  /** `additive` = Ctrl/Cmd/Shift was held: add to the selection. */
  readonly onElementClick?: (id: string, additive: boolean) => void;
  readonly onBackgroundClick?: () => void;
  /** Marquee and context-menu gestures (see SelectionGestures). */
  readonly select?: SelectionGestures | undefined;
  /** Dragging from an entity = draw a new relationship to the drop target. */
  readonly onConnectDrag?: (fromId: string, x: number, y: number) => void;
  readonly onConnectDrop?: (fromId: string, x: number, y: number) => void;
  readonly connectLine?: { x1: number; y1: number; x2: number; y2: number } | undefined;
  readonly onGestureCancel?: () => void;
}

const PADDING = 20;
const FOOT = 12;
const SPREAD = 7;

export function ErView({
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
}: ErViewProps) {
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
      <g transform={`translate(${g.viewport.x} ${g.viewport.y}) scale(${g.viewport.scale})`} data-gm-root="">
        {layout.edges.map((e) => (
          <ErEdgeView key={e.id} e={e} selected={sel.has(e.id)} />
        ))}
        {layout.boxes.map((b) => (
          <ErBoxView key={b.id} b={b} selected={sel.has(b.id)} />
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
      {g.band !== undefined && (
        <g transform={`translate(${g.viewport.x} ${g.viewport.y}) scale(${g.viewport.scale})`}>
          <MarqueeRect band={g.band} />
        </g>
      )}
    </svg>
  );
}

function ErBoxView({ b, selected }: { b: ErEntityBox; selected: boolean }) {
  const { x, y, w, h } = b.rect;
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #333)";
  const [cType, cName, cKeys, cComment] = b.columns;
  return (
    <g data-element-id={b.id} data-drag="connect" style={{ cursor: "pointer" }}>
      <rect x={x} y={y} width={w} height={h} rx={3} fill="var(--gm-node-fill, #fff)" stroke={stroke} strokeWidth={selected ? 2.5 : 1.4} />
      <text x={x + w / 2} y={(y + b.headerBottom) / 2 + 5} textAnchor="middle" fontSize={14} fontWeight={700} fontFamily="sans-serif" fill="var(--gm-text, #111)" style={{ userSelect: "none" }}>
        {b.title}
      </text>
      {b.rows.length > 0 && <line x1={x} y1={b.headerBottom} x2={x + w} y2={b.headerBottom} stroke={stroke} strokeWidth={1} />}
      {b.rows.map((r) => (
        <g key={r.id} data-attribute-id={r.id} fontSize={12} fontFamily="sans-serif" fill="var(--gm-text, #222)" style={{ userSelect: "none" }}>
          <text x={cType} y={r.y + 4}>
            {r.type}
          </text>
          <text x={cName} y={r.y + 4} fontWeight={600}>
            {r.name}
          </text>
          {r.keys !== "" && (
            <text x={cKeys} y={r.y + 4} fill="var(--gm-selected, #1a73e8)">
              {r.keys}
            </text>
          )}
          {r.comment !== "" && (
            <text x={cComment} y={r.y + 4} fill="var(--gm-text-muted, #777)" fontStyle="italic">
              {r.comment}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

/** Unit vector from `a` towards `b` (fallback: straight down). */
function unit(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return len === 0 ? { x: 0, y: 1 } : { x: dx / len, y: dy / len };
}

/** Crow's-foot glyph for one end: `p` is where the line meets the entity, `q`
 * the next point along the line (which way is "away from the entity"). */
function EndGlyph({ p, q, card, stroke }: { p: { x: number; y: number }; q: { x: number; y: number }; card: ErCardinality; stroke: string }) {
  const u = unit(p, q);
  const n = { x: -u.y, y: u.x };
  const at = (d: number, s = 0) => ({ x: p.x + u.x * d + n.x * s, y: p.y + u.y * d + n.y * s });
  const bar = (d: number, key: string) => {
    const a = at(d, -SPREAD);
    const b = at(d, SPREAD);
    return <line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={1.5} />;
  };
  const foot = () => {
    const tip = at(FOOT);
    const l = at(0, -SPREAD);
    const r = at(0, SPREAD);
    return (
      <g key="foot">
        <line x1={tip.x} y1={tip.y} x2={l.x} y2={l.y} stroke={stroke} strokeWidth={1.5} />
        <line x1={tip.x} y1={tip.y} x2={r.x} y2={r.y} stroke={stroke} strokeWidth={1.5} />
      </g>
    );
  };
  const ring = (d: number) => {
    const c = at(d);
    return <circle key="ring" cx={c.x} cy={c.y} r={4} fill="var(--gm-bg, #fff)" stroke={stroke} strokeWidth={1.5} />;
  };
  switch (card) {
    case "exactly-one":
      return <g data-card={card}>{[bar(8, "a"), bar(13, "b")]}</g>;
    case "zero-or-one":
      return <g data-card={card}>{[bar(8, "a"), ring(17)]}</g>;
    case "one-or-more":
      return <g data-card={card}>{[foot(), bar(FOOT + 4, "a")]}</g>;
    case "zero-or-more":
      return <g data-card={card}>{[foot(), ring(FOOT + 6)]}</g>;
  }
}

function ErEdgeView({ e, selected }: { e: ErEdge; selected: boolean }) {
  const d = edgePath(e.points);
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #333)";
  const pts = e.points;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  return (
    <g data-element-id={e.id} style={{ cursor: "pointer" }}>
      {/* fat transparent stroke: the hit area for a 1.4px line */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
      <path d={d} fill="none" stroke={stroke} strokeWidth={selected ? 2.4 : 1.4} strokeDasharray={e.identifying ? undefined : "6 4"} />
      <EndGlyph p={first} q={pts[1] ?? last} card={e.fromCard} stroke={stroke} />
      <EndGlyph p={last} q={pts[pts.length - 2] ?? first} card={e.toCard} stroke={stroke} />
      {e.label !== "" && (
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
      )}
    </g>
  );
}
