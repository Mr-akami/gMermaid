import { useRef, type PointerEvent } from "react";
import type { FragmentFrame, MessageRow, SequenceLayout } from "@gmermaid/layout";

// Fragment frames draw UNDER the messages with a transparent fill; only
// their border and label tab are clickable (pointer-events on the stroke),
// so frames never steal clicks from the arrows they overlap (CONTEXT.md).
export interface SequenceViewState {
  readonly selectedId?: string | undefined;
}

export interface SequenceViewProps {
  readonly layout: SequenceLayout;
  readonly viewState: SequenceViewState;
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
}

const DRAG_THRESHOLD = 5;

interface PointerState {
  /** Set when the press started on a draggable element. */
  dragKind: "message" | "fragment-bottom" | "divider" | "lifeline" | "spine" | null;
  /** Element under the initial press, for click-on-release. */
  targetId: string | null;
  startX: number;
  startY: number;
  active: boolean;
}

const PADDING = 10;

export function SequenceView({
  layout,
  viewState,
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
}: SequenceViewProps) {
  // pointer bookkeeping only — all meaning lives in the emitted intents.
  // Clicks are resolved on pointerup from the ORIGINAL press target: pointer
  // capture retargets the browser's native click to the svg root, which
  // would otherwise turn every message click into a background click.
  const pointer = useRef<PointerState | null>(null);

  function diagramPoint(e: PointerEvent<SVGSVGElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left - PADDING, y: e.clientY - rect.top - PADDING };
  }

  function handlePointerDown(e: PointerEvent<SVGSVGElement>) {
    const target = e.target as Element;
    const dragEl = target.closest("[data-drag]");
    const targetId = target.closest("[data-element-id]")?.getAttribute("data-element-id") ?? null;
    const { x, y } = diagramPoint(e);
    pointer.current = {
      dragKind: (dragEl?.getAttribute("data-drag") as PointerState["dragKind"]) ?? null,
      targetId,
      startX: x,
      startY: y,
      active: false,
    };
    if (dragEl) e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent<SVGSVGElement>) {
    const p = pointer.current;
    if (!p || p.dragKind === null || p.targetId === null) return;
    const { x, y } = diagramPoint(e);
    if (!p.active && Math.abs(y - p.startY) < DRAG_THRESHOLD && Math.abs(x - p.startX) < DRAG_THRESHOLD) return;
    p.active = true;
    if (p.dragKind === "message") onMessageDrag?.(p.targetId, y);
    else if (p.dragKind === "divider") onDividerDrag?.(p.targetId, y);
    else if (p.dragKind === "lifeline") onLifelineDrag?.(p.targetId, x);
    else if (p.dragKind === "spine") onSpineDrag?.(p.targetId, x, y);
    else onFragmentBottomDrag?.(p.targetId, y);
  }

  function handlePointerUp(e: PointerEvent<SVGSVGElement>) {
    const p = pointer.current;
    pointer.current = null;
    if (!p) return;
    if (p.active && p.dragKind !== null && p.targetId !== null) {
      const { x, y } = diagramPoint(e);
      if (p.dragKind === "message") onMessageDrop?.(p.targetId, y);
      else if (p.dragKind === "divider") onDividerDrop?.(p.targetId, y);
      else if (p.dragKind === "lifeline") onLifelineDrop?.(p.targetId, x);
      else if (p.dragKind === "spine") onSpineDrop?.(p.targetId, x, y);
      else onFragmentBottomDrop?.(p.targetId, y);
      return;
    }
    // no drag happened: this press was a click
    if (p.targetId !== null) onElementClick?.(p.targetId);
    else onBackgroundClick?.();
  }

  return (
    <svg
      width={layout.size.w + PADDING * 2}
      height={layout.size.h + PADDING * 2}
      viewBox={`${-PADDING} ${-PADDING} ${layout.size.w + PADDING * 2} ${layout.size.h + PADDING * 2}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <defs>
        <marker id="gm-seq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--gm-stroke, #333)" />
        </marker>
        <marker id="gm-seq-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="var(--gm-stroke, #333)" strokeWidth="1.5" />
        </marker>
      </defs>

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

function MessageView({ m, selected }: { m: MessageRow; selected: boolean }) {
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #333)";
  const dash = m.arrow === "dotted" || m.arrow === "dottedOpen" ? "5 4" : undefined;
  const marker = m.arrow === "solidOpen" || m.arrow === "dottedOpen" || m.arrow === "async" ? "url(#gm-seq-open)" : "url(#gm-seq-arrow)";
  const isSelf = m.fromX === m.toX;
  const d = isSelf
    ? `M ${m.fromX} ${m.y} h 36 v 18 h -36`
    : `M ${m.fromX} ${m.y} L ${m.toX} ${m.y}`;
  return (
    <g data-element-id={m.id} data-drag="message" style={{ cursor: "pointer" }}>
      <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
      <path d={d} fill="none" stroke={stroke} strokeWidth={selected ? 2.2 : 1.4} strokeDasharray={dash} markerEnd={marker} />
      {m.label !== "" && (
        <text
          x={isSelf ? m.fromX + 44 : m.labelPos.x}
          y={isSelf ? m.y + 9 : m.labelPos.y}
          textAnchor={isSelf ? "start" : "middle"}
          fontSize={12}
          fontFamily="sans-serif"
          fill="var(--gm-text, #111)"
          style={{ paintOrder: "stroke", stroke: "var(--gm-bg, #fff)", strokeWidth: 4, userSelect: "none" }}
        >
          {m.label}
        </text>
      )}
    </g>
  );
}
