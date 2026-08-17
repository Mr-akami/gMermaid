import { useRef, type PointerEvent } from "react";
import type { ClassBox, ClassLayout, RelationPath } from "@gmermaid/layout";

export interface ClassViewState {
  readonly selectedId?: string | undefined;
}

export interface ClassViewProps {
  readonly layout: ClassLayout;
  readonly viewState: ClassViewState;
  readonly onElementClick?: (id: string) => void;
  readonly onBackgroundClick?: () => void;
  /** Dragging from a class = draw a new relation to the drop target. */
  readonly onConnectDrag?: (fromId: string, x: number, y: number) => void;
  readonly onConnectDrop?: (fromId: string, x: number, y: number) => void;
  readonly connectLine?: { x1: number; y1: number; x2: number; y2: number } | undefined;
}

const PADDING = 20;
const DRAG_THRESHOLD = 5;

export function ClassView({
  layout,
  viewState,
  onElementClick,
  onBackgroundClick,
  onConnectDrag,
  onConnectDrop,
  connectLine,
}: ClassViewProps) {
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
        {/* hollow triangle: inheritance / realization */}
        <marker id="gm-cls-tri" viewBox="0 0 14 14" refX="13" refY="7" markerWidth="14" markerHeight="14" orient="auto-start-reverse">
          <path d="M 1 1 L 13 7 L 1 13 z" fill="var(--gm-bg, #fff)" stroke="var(--gm-stroke, #333)" strokeWidth="1.2" />
        </marker>
        {/* filled diamond: composition */}
        <marker id="gm-cls-dia-filled" viewBox="0 0 16 10" refX="15" refY="5" markerWidth="16" markerHeight="10" orient="auto-start-reverse">
          <path d="M 1 5 L 8 1 L 15 5 L 8 9 z" fill="var(--gm-stroke, #333)" />
        </marker>
        {/* hollow diamond: aggregation */}
        <marker id="gm-cls-dia-open" viewBox="0 0 16 10" refX="15" refY="5" markerWidth="16" markerHeight="10" orient="auto-start-reverse">
          <path d="M 1 5 L 8 1 L 15 5 L 8 9 z" fill="var(--gm-bg, #fff)" stroke="var(--gm-stroke, #333)" strokeWidth="1.2" />
        </marker>
        {/* open arrow: association / dependency */}
        <marker id="gm-cls-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="var(--gm-stroke, #333)" strokeWidth="1.5" />
        </marker>
      </defs>

      {layout.relations.map((r) => (
        <RelationView key={r.id} r={r} selected={viewState.selectedId === r.id} />
      ))}
      {layout.classes.map((c) => (
        <ClassBoxView key={c.id} c={c} selected={viewState.selectedId === c.id} />
      ))}
      {connectLine !== undefined && (
        <line x1={connectLine.x1} y1={connectLine.y1} x2={connectLine.x2} y2={connectLine.y2} stroke="var(--gm-selected, #1a73e8)" strokeWidth={1.5} strokeDasharray="6 4" markerEnd="url(#gm-cls-open)" style={{ pointerEvents: "none" }} />
      )}
    </svg>
  );
}

const MEMBER_LINE_H = 18;

function ClassBoxView({ c, selected }: { c: ClassBox; selected: boolean }) {
  const { x, y, w, h } = c.rect;
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #333)";
  const nameY = c.stereotype !== undefined ? y + (c.headerBottom - y) / 2 + 8 : y + (c.headerBottom - y) / 2;
  return (
    <g data-element-id={c.id} data-drag="connect" style={{ cursor: "pointer" }}>
      <rect x={x} y={y} width={w} height={h} fill="var(--gm-node-fill, #fff)" stroke={stroke} strokeWidth={selected ? 2.5 : 1.4} />
      <line x1={x} y1={c.headerBottom} x2={x + w} y2={c.headerBottom} stroke={stroke} strokeWidth={1} />
      <line x1={x} y1={c.attributesBottom} x2={x + w} y2={c.attributesBottom} stroke={stroke} strokeWidth={1} />
      {c.stereotype !== undefined && (
        <text x={x + w / 2} y={y + 14} textAnchor="middle" fontSize={12} fontFamily="monospace" fill="var(--gm-text, #555)" style={{ userSelect: "none" }}>
          {`«${c.stereotype}»`}
        </text>
      )}
      <text x={x + w / 2} y={nameY} textAnchor="middle" dominantBaseline="central" fontSize={14} fontWeight={700} fontFamily="sans-serif" fill="var(--gm-text, #111)" style={{ userSelect: "none" }}>
        {c.name}
      </text>
      {c.attributes.map((a, i) => (
        <text key={i} x={x + 10} y={c.headerBottom + 5 + (i + 0.7) * MEMBER_LINE_H - 4} fontSize={12} fontFamily="monospace" fill="var(--gm-text, #222)" style={{ userSelect: "none" }}>
          {a}
        </text>
      ))}
      {c.methods.map((m, i) => (
        <text key={i} x={x + 10} y={c.attributesBottom + 5 + (i + 0.7) * MEMBER_LINE_H - 4} fontSize={12} fontFamily="monospace" fill="var(--gm-text, #222)" style={{ userSelect: "none" }}>
          {m}
        </text>
      ))}
    </g>
  );
}

function RelationView({ r, selected }: { r: RelationPath; selected: boolean }) {
  const d = r.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #333)";
  const dashed = r.type === "dependency" || r.type === "realization";
  const marker =
    r.type === "inheritance" || r.type === "realization"
      ? "url(#gm-cls-tri)"
      : r.type === "composition"
        ? "url(#gm-cls-dia-filled)"
        : r.type === "aggregation"
          ? "url(#gm-cls-dia-open)"
          : "url(#gm-cls-open)";
  return (
    <g data-element-id={r.id} style={{ cursor: "pointer" }}>
      <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
      <path d={d} fill="none" stroke={stroke} strokeWidth={selected ? 2.4 : 1.4} strokeDasharray={dashed ? "6 4" : undefined} markerEnd={marker} />
      {r.label !== undefined && r.labelPos && (
        <text x={r.labelPos.x} y={r.labelPos.y} textAnchor="middle" fontSize={12} fontFamily="sans-serif" fill="var(--gm-text, #111)" style={{ paintOrder: "stroke", stroke: "var(--gm-bg, #fff)", strokeWidth: 4, userSelect: "none" }}>
          {r.label}
        </text>
      )}
      {r.fromCardinality !== undefined && r.fromCardinalityPos && (
        <text x={r.fromCardinalityPos.x} y={r.fromCardinalityPos.y} fontSize={11} fontFamily="sans-serif" fill="var(--gm-text, #333)" style={{ userSelect: "none" }}>
          {r.fromCardinality}
        </text>
      )}
      {r.toCardinality !== undefined && r.toCardinalityPos && (
        <text x={r.toCardinalityPos.x} y={r.toCardinalityPos.y} fontSize={11} fontFamily="sans-serif" fill="var(--gm-text, #333)" style={{ userSelect: "none" }}>
          {r.toCardinality}
        </text>
      )}
    </g>
  );
}
