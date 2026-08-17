import type { FragmentFrame, MessageRow, SequenceLayout } from "@gmermaid/layout";
import { usePointerGestures, type Viewport } from "./usePointerGestures";

// Fragment frames draw UNDER the messages with a transparent fill; only
// their border and label tab are clickable (pointer-events on the stroke),
// so frames never steal clicks from the arrows they overlap (CONTEXT.md).
export interface SequenceViewState {
  readonly selectedId?: string | undefined;
}

export interface SequenceViewProps {
  readonly layout: SequenceLayout;
  readonly viewState: SequenceViewState;
  /** Pan/zoom; undefined = default (identity, padding offset). */
  readonly viewport?: Viewport | undefined;
  readonly onViewportChange?: ((v: Viewport) => void) | undefined;
  readonly onElementClick?: (id: string) => void;
  readonly onBackgroundClick?: () => void;
  /** Live y (diagram space) while dragging a message row. */
  readonly onMessageDrag?: (id: string, y: number) => void;
  readonly onMessageDrop?: (id: string, y: number) => void;
  /** Dragging a fragment's bottom border (resize = membership change). */
  readonly onFragmentBottomDrag?: (id: string, y: number) => void;
  readonly onFragmentBottomDrop?: (id: string, y: number) => void;
  /** Dragging an else/and divider (moves messages between branches). */
  readonly onDividerDrag?: (branchId: string, y: number) => void;
  readonly onDividerDrop?: (branchId: string, y: number) => void;
  /** Dragging a lifeline head left/right (reorder). */
  readonly onLifelineDrag?: (id: string, x: number) => void;
  readonly onLifelineDrop?: (id: string, x: number) => void;
  /** Dragging from a lifeline spine (create a message to another lifeline). */
  readonly onSpineDrag?: (id: string, x: number, y: number) => void;
  readonly onSpineDrop?: (id: string, x: number, y: number) => void;
  /** Insertion indicator, provided by the app while a drag is live. */
  readonly dropIndicatorY?: number | undefined;
  /** Vertical indicator for lifeline reordering. */
  readonly dropIndicatorX?: number | undefined;
  /** Rubber band for the message-creation gesture. */
  readonly connectLine?: { x1: number; y1: number; x2: number; y2: number } | undefined;
  /** The pointer was cancelled mid-gesture (touch scroll etc.) — clear any
   * drag feedback the app is showing. */
  readonly onGestureCancel?: () => void;
}

const PADDING = 10;

export function SequenceView({
  layout,
  viewState,
  viewport,
  onViewportChange,
  onElementClick,
  onBackgroundClick,
  onMessageDrag,
  onMessageDrop,
  onFragmentBottomDrag,
  onFragmentBottomDrop,
  onDividerDrag,
  onDividerDrop,
  onLifelineDrag,
  onLifelineDrop,
  onSpineDrag,
  onSpineDrop,
  dropIndicatorY,
  dropIndicatorX,
  connectLine,
  onGestureCancel,
}: SequenceViewProps) {
  // pointer bookkeeping lives in the shared hook — all meaning stays in the
  // emitted intents; this component only routes them per drag kind.
  const g = usePointerGestures({
    padding: PADDING,
    viewport,
    onViewportChange,
    dragKinds: ["message", "fragment-bottom", "divider", "lifeline", "spine"],
    onElementClick,
    onBackgroundClick,
    onDrag: (kind, id, x, y) => {
      if (kind === "message") onMessageDrag?.(id, y);
      else if (kind === "divider") onDividerDrag?.(id, y);
      else if (kind === "lifeline") onLifelineDrag?.(id, x);
      else if (kind === "spine") onSpineDrag?.(id, x, y);
      else if (kind === "fragment-bottom") onFragmentBottomDrag?.(id, y);
    },
    onDrop: (kind, id, x, y) => {
      if (kind === "message") onMessageDrop?.(id, y);
      else if (kind === "divider") onDividerDrop?.(id, y);
      else if (kind === "lifeline") onLifelineDrop?.(id, x);
      else if (kind === "spine") onSpineDrop?.(id, x, y);
      else if (kind === "fragment-bottom") onFragmentBottomDrop?.(id, y);
    },
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
        <marker id="gm-seq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--gm-stroke, #333)" />
        </marker>
        <marker id="gm-seq-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="var(--gm-stroke, #333)" strokeWidth="1.5" />
        </marker>
        <marker id="gm-seq-cross" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
          <path d="M 1 1 L 9 9 M 9 1 L 1 9" fill="none" stroke="var(--gm-stroke, #333)" strokeWidth="1.5" />
        </marker>
      </defs>

      <g transform={`translate(${g.viewport.x} ${g.viewport.y}) scale(${g.viewport.scale})`}>
      {/* lifeline spines + heads */}
      {layout.lifelines.map((l) => (
        <g key={l.id} data-element-id={l.id} style={{ cursor: "pointer" }}>
          {/* wide grip on the spine: drag = draw a new message */}
          <line x1={l.x} y1={l.spineTop} x2={l.x} y2={l.spineBottom} stroke="transparent" strokeWidth={14} data-drag="spine" style={{ cursor: "crosshair" }} />
          <line x1={l.x} y1={l.spineTop} x2={l.x} y2={l.spineBottom} stroke="var(--gm-stroke, #999)" strokeDasharray="4 4" style={{ pointerEvents: "none" }} />
          <rect
            data-drag="lifeline"
            x={l.headRect.x}
            y={l.headRect.y}
            width={l.headRect.w}
            height={l.headRect.h}
            rx={l.isActor ? l.headRect.h / 2 : 3}
            fill="var(--gm-node-fill, #eef3fb)"
            stroke={viewState.selectedId === l.id ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #333)"}
            strokeWidth={viewState.selectedId === l.id ? 2.5 : 1.2}
          />
          <text
            x={l.x}
            y={l.headRect.y + l.headRect.h / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={13}
            fontFamily="sans-serif"
            fill="var(--gm-text, #111)"
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            {l.name}
          </text>
        </g>
      ))}

      {/* fragment frames go under the messages */}
      {layout.fragments.map((f) => (
        <FragmentView key={f.id} f={f} selected={viewState.selectedId === f.id} selectedId={viewState.selectedId} />
      ))}

      {layout.messages.map((m) => (
        <MessageView key={m.id} m={m} selected={viewState.selectedId === m.id} />
      ))}

      {layout.notes.map((n) => (
        <g key={n.id} data-element-id={n.id} style={{ cursor: "pointer" }}>
          {n.anchor && (
            <line x1={n.anchor.x1} y1={n.anchor.y1} x2={n.anchor.x2} y2={n.anchor.y2} stroke="var(--gm-note-line, #b59a2e)" strokeWidth={1} strokeDasharray="3 3" style={{ pointerEvents: "none" }} />
          )}
          <rect x={n.rect.x} y={n.rect.y} width={n.rect.w} height={n.rect.h} rx={3} fill="var(--gm-note-fill, #fdf6d3)" stroke="var(--gm-note-stroke, #c8b25a)" strokeWidth={1} />
          <text x={n.rect.x + n.rect.w / 2} y={n.rect.y + n.rect.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={12} fontFamily="sans-serif" fill="var(--gm-text, #333)" style={{ pointerEvents: "none", userSelect: "none" }}>
            {n.text}
          </text>
        </g>
      ))}

      {connectLine !== undefined && (
        <line x1={connectLine.x1} y1={connectLine.y1} x2={connectLine.x2} y2={connectLine.y2} stroke="var(--gm-selected, #1a73e8)" strokeWidth={1.5} strokeDasharray="6 4" style={{ pointerEvents: "none" }} />
      )}
      {dropIndicatorX !== undefined && (
        <line x1={dropIndicatorX} y1={0} x2={dropIndicatorX} y2={layout.size.h} stroke="var(--gm-selected, #1a73e8)" strokeWidth={2} strokeDasharray="8 4" style={{ pointerEvents: "none" }} />
      )}
      {dropIndicatorY !== undefined && (
        <line
          x1={0}
          y1={dropIndicatorY}
          x2={layout.size.w}
          y2={dropIndicatorY}
          stroke="var(--gm-selected, #1a73e8)"
          strokeWidth={2}
          strokeDasharray="8 4"
          style={{ pointerEvents: "none" }}
        />
      )}
      </g>
    </svg>
  );
}

function FragmentView({ f, selected, selectedId }: { f: FragmentFrame; selected: boolean; selectedId?: string | undefined }) {
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #555)";
  const { x, y, w, h } = f.rect;
  return (
    <g>
      {/* translucent body: visible but never clickable */}
      <rect x={x} y={y} width={w} height={h} fill="var(--gm-frag-fill, rgba(120,140,180,0.06))" style={{ pointerEvents: "none" }} />
      {/* border + label tab are the fragment's only hit targets */}
      <g data-element-id={f.id} style={{ cursor: "pointer" }}>
        <rect x={x} y={y} width={w} height={h} fill="none" stroke={stroke} strokeWidth={selected ? 2 : 1.2} pointerEvents="stroke" />
        {/* invisible resize handle on the bottom border: drag = membership change */}
        <rect
          x={x}
          y={y + h - 5}
          width={w}
          height={10}
          fill="transparent"
          data-drag="fragment-bottom"
          style={{ cursor: "ns-resize" }}
        />
        <path
          d={`M ${x} ${y} h ${f.labelTab.w} v ${f.labelTab.h - 6} l -8 6 h ${-(f.labelTab.w - 8)} z`}
          fill="var(--gm-tab-fill, #dfe7f5)"
          stroke={stroke}
          strokeWidth={1}
        />
        <text
          x={x + f.labelTab.w / 2 - 2}
          y={y + f.labelTab.h / 2 - 1}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={11}
          fontWeight={600}
          fontFamily="sans-serif"
          fill="var(--gm-text, #111)"
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          {f.fragmentKind}
        </text>
      </g>
      {f.branches.map((b) => (
        <g key={b.id} data-element-id={b.id}>
          {b.dividerY !== undefined && (
            <>
              {/* wide invisible grip so the divider is easy to grab */}
              <line x1={x} y1={b.dividerY} x2={x + w} y2={b.dividerY} stroke="transparent" strokeWidth={12} data-drag="divider" style={{ cursor: "row-resize" }} />
              <line x1={x} y1={b.dividerY} x2={x + w} y2={b.dividerY} stroke={stroke} strokeDasharray="6 4" style={{ pointerEvents: "none" }} />
            </>
          )}
          {b.condition !== "" && (
            <text
              x={b.conditionPos.x}
              y={b.conditionPos.y}
              fontSize={11}
              fontStyle="italic"
              fontFamily="sans-serif"
              fill={selectedId === b.id ? "var(--gm-selected, #1a73e8)" : "var(--gm-text, #444)"}
              style={{ userSelect: "none", cursor: "pointer" }}
            >
              [{b.condition}]
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

const DASHED_ARROWS = new Set(["dotted", "dottedOpen", "dottedAsync", "dottedCross", "dottedBidirectional"]);
const OPEN_ARROWS = new Set(["solidOpen", "dottedOpen", "async", "dottedAsync"]);

function MessageView({ m, selected }: { m: MessageRow; selected: boolean }) {
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #333)";
  const dash = DASHED_ARROWS.has(m.arrow) ? "5 4" : undefined;
  const marker =
    m.arrow === "cross" || m.arrow === "dottedCross"
      ? "url(#gm-seq-cross)"
      : OPEN_ARROWS.has(m.arrow)
        ? "url(#gm-seq-open)"
        : "url(#gm-seq-arrow)";
  const bidir = m.arrow === "bidirectional" || m.arrow === "dottedBidirectional";
  const isSelf = m.fromX === m.toX;
  const d = isSelf
    ? `M ${m.fromX} ${m.y} h 36 v 18 h -36`
    : `M ${m.fromX} ${m.y} L ${m.toX} ${m.y}`;
  const label = m.seq !== undefined ? `${m.seq}: ${m.label}` : m.label;
  return (
    <g data-element-id={m.id} data-drag="message" style={{ cursor: "pointer" }}>
      <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
      <path d={d} fill="none" stroke={stroke} strokeWidth={selected ? 2.2 : 1.4} strokeDasharray={dash} markerEnd={marker} markerStart={bidir ? marker : undefined} />
      {label !== "" && (
        <text
          x={isSelf ? m.fromX + 44 : m.labelPos.x}
          y={isSelf ? m.y + 9 : m.labelPos.y}
          textAnchor={isSelf ? "start" : "middle"}
          fontSize={12}
          fontFamily="sans-serif"
          fill="var(--gm-text, #111)"
          style={{ paintOrder: "stroke", stroke: "var(--gm-bg, #fff)", strokeWidth: 4, userSelect: "none" }}
        >
          {label}
        </text>
      )}
    </g>
  );
}
