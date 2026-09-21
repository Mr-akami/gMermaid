import type { ClassBox, ClassLayout, ClassNoteBox, NamespaceFrame, RelationPath } from "@gmermaid/layout";
import { NAMESPACE_TITLE_BAND } from "@gmermaid/layout";
import { edgePath } from "./edgePath";
import { usePointerGestures, type Viewport } from "./usePointerGestures";

export interface ClassViewState {
  readonly selectedId?: string | undefined;
}

export interface ClassViewProps {
  readonly layout: ClassLayout;
  readonly viewState: ClassViewState;
  /** Pan/zoom; undefined = default (identity, padding offset). */
  readonly viewport?: Viewport | undefined;
  readonly onViewportChange?: ((v: Viewport) => void) | undefined;
  readonly onElementClick?: (id: string) => void;
  readonly onBackgroundClick?: () => void;
  /** Dragging from a class = draw a new relation to the drop target. */
  readonly onConnectDrag?: (fromId: string, x: number, y: number) => void;
  readonly onConnectDrop?: (fromId: string, x: number, y: number) => void;
  readonly connectLine?: { x1: number; y1: number; x2: number; y2: number } | undefined;
  readonly onGestureCancel?: () => void;
}

const PADDING = 20;

export function ClassView({
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
}: ClassViewProps) {
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
        {/* every marker is orient="auto-start-reverse" so the same shape
            serves markerStart (reversed relation tokens) and markerEnd */}
        {/* hollow triangle: inheritance (dashed line = realization) */}
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
        {/* open arrow: association (dashed line = dependency) */}
        <marker id="gm-cls-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="var(--gm-stroke, #333)" strokeWidth="1.5" />
        </marker>
        {/* lollipop: provided-interface circle */}
        <marker id="gm-cls-lolli" viewBox="0 0 14 14" refX="13" refY="7" markerWidth="12" markerHeight="12" orient="auto-start-reverse">
          <circle cx="7" cy="7" r="5" fill="var(--gm-bg, #fff)" stroke="var(--gm-stroke, #333)" strokeWidth="1.2" />
        </marker>
      </defs>

      <g transform={`translate(${g.viewport.x} ${g.viewport.y}) scale(${g.viewport.scale})`}>
        {layout.namespaces.map((n) => (
          <NamespaceView key={n.id} n={n} selected={viewState.selectedId === n.id} />
        ))}
        {layout.relations.map((r) => (
          <RelationView key={r.id} r={r} selected={viewState.selectedId === r.id} />
        ))}
        {layout.classes.map((c) => (
          <ClassBoxView key={c.id} c={c} selected={viewState.selectedId === c.id} />
        ))}
        {layout.notes.map((n) => (
          <NoteView key={n.id} n={n} selected={viewState.selectedId === n.id} />
        ))}
        {connectLine !== undefined && (
          <line x1={connectLine.x1} y1={connectLine.y1} x2={connectLine.x2} y2={connectLine.y2} stroke="var(--gm-selected, #1a73e8)" strokeWidth={1.5} strokeDasharray="6 4" markerEnd="url(#gm-cls-open)" style={{ pointerEvents: "none" }} />
        )}
      </g>
    </svg>
  );
}

const MEMBER_LINE_H = 18;

function NamespaceView({ n, selected }: { n: NamespaceFrame; selected: boolean }) {
  const { x, y, w, h } = n.rect;
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #555)";
  return (
    <g>
      {/* translucent body: visible but never clickable (like composite states) */}
      <rect x={x} y={y} width={w} height={h} rx={6} fill="var(--gm-frag-fill, rgba(120,140,180,0.06))" style={{ pointerEvents: "none" }} />
      <g data-element-id={n.id} style={{ cursor: "pointer" }}>
        <rect x={x} y={y} width={w} height={h} rx={6} fill="none" stroke={stroke} strokeWidth={selected ? 2 : 1.2} strokeDasharray="4 3" pointerEvents="stroke" />
        <text x={x + 10} y={y + NAMESPACE_TITLE_BAND - 8} fontSize={12} fontWeight={600} fontFamily="sans-serif" fill="var(--gm-text, #333)" style={{ userSelect: "none" }}>
          {n.name}
        </text>
      </g>
    </g>
  );
}

function NoteView({ n, selected }: { n: ClassNoteBox; selected: boolean }) {
  const { x, y, w, h } = n.rect;
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-note-stroke, #c8b25a)";
  const lines = n.text.split("\n");
  return (
    <g data-element-id={n.id} style={{ cursor: "pointer" }}>
      {n.link !== undefined && (
        <path
          d={n.link.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")}
          fill="none"
          stroke="var(--gm-note-line, #b59a2e)"
          strokeWidth={1}
          strokeDasharray="3 3"
          style={{ pointerEvents: "none" }}
        />
      )}
      <rect x={x} y={y} width={w} height={h} rx={3} fill="var(--gm-note-fill, #fdf6d3)" stroke={stroke} strokeWidth={selected ? 2 : 1} />
      {lines.map((t, i) => (
        <text
          key={i}
          x={x + w / 2}
          y={y + h / 2 + (i - (lines.length - 1) / 2) * 14}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={12}
          fontFamily="sans-serif"
          fill="var(--gm-text, #333)"
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          {t}
        </text>
      ))}
    </g>
  );
}

function ClassBoxView({ c, selected }: { c: ClassBox; selected: boolean }) {
  const { x, y, w, h } = c.rect;
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #333)";
  const nameY = y + (c.headerBottom - y + c.stereotypes.length * MEMBER_LINE_H) / 2;
  return (
    <g data-element-id={c.id} data-drag="connect" style={{ cursor: "pointer" }}>
      <rect x={x} y={y} width={w} height={h} fill="var(--gm-node-fill, #fff)" stroke={stroke} strokeWidth={selected ? 2.5 : 1.4} />
      <line x1={x} y1={c.headerBottom} x2={x + w} y2={c.headerBottom} stroke={stroke} strokeWidth={1} />
      <line x1={x} y1={c.attributesBottom} x2={x + w} y2={c.attributesBottom} stroke={stroke} strokeWidth={1} />
      {c.stereotypes.map((s, i) => (
        <text key={i} x={x + w / 2} y={y + 14 + i * MEMBER_LINE_H} textAnchor="middle" fontSize={12} fontFamily="monospace" fill="var(--gm-text, #555)" style={{ userSelect: "none" }}>
          {`«${s}»`}
        </text>
      ))}
      <text x={x + w / 2} y={nameY} textAnchor="middle" dominantBaseline="central" fontSize={14} fontWeight={700} fontFamily="sans-serif" fill="var(--gm-text, #111)" style={{ userSelect: "none" }}>
        {c.name}
      </text>
      {c.attributes.map((a, i) => (
        <MemberText key={i} x={x + 10} y={c.headerBottom + 5 + (i + 0.7) * MEMBER_LINE_H - 4} m={a} />
      ))}
      {c.methods.map((m, i) => (
        <MemberText key={i} x={x + 10} y={c.attributesBottom + 5 + (i + 0.7) * MEMBER_LINE_H - 4} m={m} />
      ))}
    </g>
  );
}

/** Mermaid's classifiers are styling, not text: `$` = static (underline), `*` = abstract (italic). */
function MemberText({ x, y, m }: { x: number; y: number; m: { text: string; static: boolean; abstract: boolean } }) {
  return (
    <text
      x={x}
      y={y}
      fontSize={12}
      fontFamily="monospace"
      fill="var(--gm-text, #222)"
      fontStyle={m.abstract ? "italic" : undefined}
      textDecoration={m.static ? "underline" : undefined}
      style={{ userSelect: "none" }}
    >
      {m.text}
    </text>
  );
}

const MARKER: Record<RelationPath["headFrom"], string | undefined> = {
  none: undefined,
  arrow: "url(#gm-cls-open)",
  inheritance: "url(#gm-cls-tri)",
  composition: "url(#gm-cls-dia-filled)",
  aggregation: "url(#gm-cls-dia-open)",
  lollipop: "url(#gm-cls-lolli)",
};

function RelationView({ r, selected }: { r: RelationPath; selected: boolean }) {
  const d = edgePath(r.points);
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #333)";
  return (
    <g data-element-id={r.id} style={{ cursor: "pointer" }}>
      <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={selected ? 2.4 : 1.4}
        strokeDasharray={r.line === "dashed" ? "6 4" : undefined}
        markerStart={MARKER[r.headFrom]}
        markerEnd={MARKER[r.headTo]}
      />
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
