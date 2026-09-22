import type {
  ActorGlyph,
  UseCaseBox,
  UsecaseBoundaryFrame,
  UsecaseEdgePath,
  UsecaseLayout,
  UsecaseNoteBox,
} from "@gmermaid/layout";
import { edgePath } from "./edgePath";
import { usePointerGestures, type Viewport , type SelectionGestures } from "./usePointerGestures";
import { MarqueeRect, selectionOf } from "./Marquee";

export interface UsecaseViewState {
  readonly selectedId?: string | undefined;
  /** The whole selection; `selectedId` is always one of these. */
  readonly selectedIds?: readonly string[] | undefined;
}

export interface UsecaseViewProps {
  readonly layout: UsecaseLayout;
  readonly viewState: UsecaseViewState;
  /** Pan/zoom; undefined = default (identity, padding offset). */
  readonly viewport?: Viewport | undefined;
  readonly onViewportChange?: ((v: Viewport) => void) | undefined;
  /** `additive` = Ctrl/Cmd/Shift was held: add to the selection. */
  readonly onElementClick?: (id: string, additive: boolean) => void;
  readonly onBackgroundClick?: () => void;
  /** Marquee and context-menu gestures (see SelectionGestures). */
  readonly select?: SelectionGestures | undefined;
  /** Dragging from an actor / use case = draw a new relation to the drop target. */
  readonly onConnectDrag?: (fromId: string, x: number, y: number) => void;
  readonly onConnectDrop?: (fromId: string, x: number, y: number) => void;
  readonly connectLine?: { x1: number; y1: number; x2: number; y2: number } | undefined;
  readonly onGestureCancel?: () => void;
}

const PADDING = 20;

/** Marker ids by head kind; `orient="auto-start-reverse"` lets the same
 * marker serve either end of the path. */
const MARKER: Record<string, string | undefined> = {
  none: undefined,
  arrow: "url(#gm-uc-arrow)",
  circle: "url(#gm-uc-circle)",
  cross: "url(#gm-uc-cross)",
  inheritance: "url(#gm-uc-tri)",
};

export function UsecaseView({
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
}: UsecaseViewProps) {
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
        <marker id="gm-uc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="var(--gm-stroke, #333)" strokeWidth={1.5} />
        </marker>
        <marker id="gm-uc-circle" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
          <circle cx="5" cy="5" r="4" fill="var(--gm-bg, #fff)" stroke="var(--gm-stroke, #333)" strokeWidth={1.2} />
        </marker>
        <marker id="gm-uc-cross" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
          <path d="M 1 1 L 9 9 M 9 1 L 1 9" fill="none" stroke="var(--gm-stroke, #333)" strokeWidth={1.5} />
        </marker>
        {/* hollow triangle: generalization */}
        <marker id="gm-uc-tri" viewBox="0 0 14 14" refX="13" refY="7" markerWidth="14" markerHeight="14" orient="auto-start-reverse">
          <path d="M 1 1 L 13 7 L 1 13 z" fill="var(--gm-bg, #fff)" stroke="var(--gm-stroke, #333)" strokeWidth={1.2} />
        </marker>
      </defs>

      <g transform={`translate(${g.viewport.x} ${g.viewport.y}) scale(${g.viewport.scale})`} data-gm-root="">
        {/* frames go under everything they contain */}
        {layout.boundaries.map((b) => (
          <BoundaryView key={b.id} b={b} selected={sel.has(b.id)} />
        ))}
        {layout.edges.map((e) => (
          <EdgeView key={e.id} e={e} selected={sel.has(e.id)} />
        ))}
        {layout.usecases.map((u) => (
          <UseCaseView key={u.id} u={u} selected={sel.has(u.id)} />
        ))}
        {layout.actors.map((a) => (
          <ActorView key={a.id} a={a} selected={sel.has(a.id)} />
        ))}
        {layout.notes.map((n) => (
          <NoteView key={n.id} n={n} selected={sel.has(n.id)} />
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
            markerEnd="url(#gm-uc-arrow)"
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

const STEREOTYPE_H = 15;

function ActorView({ a, selected }: { a: ActorGlyph; selected: boolean }) {
  const { x, y, w } = a.rect;
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #333)";
  const cx = x + w / 2;
  const headR = 8;
  const headY = y + headR + 2;
  const bodyTop = headY + headR;
  const bodyBottom = y + 34;
  const feet = y + 48;
  const armY = bodyTop + 8;
  const textTop = a.glyphBottom + 12;
  return (
    <g data-element-id={a.id} data-drag="connect" style={{ cursor: "pointer" }}>
      {/* an invisible pad makes the whole cell clickable, not just the strokes */}
      <rect x={x} y={y} width={w} height={a.rect.h} fill="transparent" />
      {a.variant === "awesome" ? (
        // awesome: one filled silhouette instead of stick limbs
        <>
          <circle cx={cx} cy={headY} r={headR} fill={stroke} />
          <path
            d={`M ${cx - 13} ${feet} v -10 a 13 13 0 0 1 26 0 v 10 z`}
            fill={stroke}
            stroke={stroke}
            strokeWidth={selected ? 2 : 1}
          />
        </>
      ) : (
        <>
          <circle
            cx={cx}
            cy={headY}
            r={headR}
            fill={a.variant === "hollow" ? "var(--gm-node-fill, #fff)" : stroke}
            stroke={stroke}
            strokeWidth={selected ? 2.5 : 1.4}
          />
          <path
            d={`M ${cx} ${bodyTop} V ${bodyBottom} M ${cx - 12} ${armY} H ${cx + 12} M ${cx} ${bodyBottom} L ${cx - 10} ${feet} M ${cx} ${bodyBottom} L ${cx + 10} ${feet}`}
            fill="none"
            stroke={stroke}
            strokeWidth={selected ? 2.4 : 1.4}
          />
        </>
      )}
      {/* the conventional business slash */}
      {a.business && <line x1={cx - 16} y1={feet} x2={cx + 4} y2={y + 6} stroke={stroke} strokeWidth={1.4} />}
      {a.stereotype !== undefined && (
        <text x={cx} y={textTop} textAnchor="middle" fontSize={11} fontFamily="sans-serif" fill="var(--gm-text, #555)" style={{ pointerEvents: "none", userSelect: "none" }}>
          {`«${a.stereotype}»`}
        </text>
      )}
      <text
        x={cx}
        y={a.stereotype !== undefined ? textTop + STEREOTYPE_H : textTop}
        textAnchor="middle"
        fontSize={13}
        fontFamily="sans-serif"
        fill="var(--gm-text, #111)"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {a.label}
      </text>
    </g>
  );
}

function UseCaseView({ u, selected }: { u: UseCaseBox; selected: boolean }) {
  const { x, y, w, h } = u.rect;
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #333)";
  const cx = x + w / 2;
  const cy = y + h / 2;
  const labelY = u.stereotype !== undefined ? cy + STEREOTYPE_H / 2 : cy;
  return (
    <g data-element-id={u.id} data-drag="connect" style={{ cursor: "pointer" }}>
      {u.shape === "ellipse" ? (
        <ellipse cx={cx} cy={cy} rx={w / 2} ry={h / 2} fill="var(--gm-node-fill, #fff)" stroke={stroke} strokeWidth={selected ? 2.5 : 1.4} />
      ) : (
        <rect x={x} y={y} width={w} height={h} rx={3} fill="var(--gm-node-fill, #fff)" stroke={stroke} strokeWidth={selected ? 2.5 : 1.4} />
      )}
      {u.business && <line x1={x + 6} y1={y + h - 6} x2={x + 18} y2={y + h - 18} stroke={stroke} strokeWidth={1.4} style={{ pointerEvents: "none" }} />}
      {u.stereotype !== undefined && (
        <text x={cx} y={labelY - STEREOTYPE_H} textAnchor="middle" dominantBaseline="central" fontSize={11} fontFamily="sans-serif" fill="var(--gm-text, #555)" style={{ pointerEvents: "none", userSelect: "none" }}>
          {`«${u.stereotype}»`}
        </text>
      )}
      <text x={cx} y={labelY} textAnchor="middle" dominantBaseline="central" fontSize={13} fontFamily="sans-serif" fill="var(--gm-text, #111)" style={{ pointerEvents: "none", userSelect: "none" }}>
        {u.label}
      </text>
    </g>
  );
}

function BoundaryView({ b, selected }: { b: UsecaseBoundaryFrame; selected: boolean }) {
  const { x, y, w, h } = b.rect;
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #666)";
  const tabW = Math.min(w - 12, Math.max(60, b.label.length * 7 + 16));
  return (
    <g>
      {/* translucent body: visible but never clickable (as in state composites) */}
      <rect x={x} y={y} width={w} height={h} rx={6} fill="var(--gm-frag-fill, rgba(120,140,180,0.06))" style={{ pointerEvents: "none" }} />
      <g data-element-id={b.id} style={{ cursor: "pointer" }}>
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={6}
          fill="none"
          stroke={stroke}
          strokeWidth={selected ? 2 : 1.2}
          strokeDasharray="7 4"
          pointerEvents="stroke"
        />
        {/* a package boundary carries its title in a tab, like a UML package */}
        {b.type === "package" && (
          <rect x={x} y={y} width={tabW} height={20} rx={3} fill="var(--gm-node-fill, #fff)" stroke={stroke} strokeWidth={selected ? 2 : 1.2} />
        )}
        <text x={x + 8} y={y + 14} fontSize={12} fontWeight={600} fontFamily="sans-serif" fill="var(--gm-text, #333)" style={{ userSelect: "none" }}>
          {b.label}
        </text>
      </g>
    </g>
  );
}

function EdgeView({ e, selected }: { e: UsecaseEdgePath; selected: boolean }) {
  const d = edgePath(e.points);
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #333)";
  return (
    <g data-element-id={e.id} style={{ cursor: "pointer" }}>
      <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={selected ? 2.4 : 1.4}
        strokeDasharray={e.line === "dashed" ? "6 4" : undefined}
        markerStart={MARKER[e.headFrom]}
        markerEnd={MARKER[e.headTo]}
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

function NoteView({ n, selected }: { n: UsecaseNoteBox; selected: boolean }) {
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-note-stroke, #c8b25a)";
  return (
    <g data-element-id={n.id} style={{ cursor: "pointer" }}>
      <line x1={n.anchor.x1} y1={n.anchor.y1} x2={n.anchor.x2} y2={n.anchor.y2} stroke="var(--gm-note-line, #b59a2e)" strokeWidth={1} strokeDasharray="3 3" style={{ pointerEvents: "none" }} />
      <rect x={n.rect.x} y={n.rect.y} width={n.rect.w} height={n.rect.h} rx={3} fill="var(--gm-note-fill, #fdf6d3)" stroke={stroke} strokeWidth={selected ? 2 : 1} />
      <text x={n.rect.x + n.rect.w / 2} y={n.rect.y + n.rect.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={11} fontFamily="sans-serif" fill="var(--gm-text, #333)" style={{ pointerEvents: "none", userSelect: "none" }}>
        {n.text}
      </text>
    </g>
  );
}
