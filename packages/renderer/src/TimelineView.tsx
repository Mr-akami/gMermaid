import type { TimelineLayout } from "@gmermaid/layout";
import { usePointerGestures, type Viewport } from "./usePointerGestures";

export interface TimelineViewState {
  readonly selectedId?: string | undefined;
}

export interface TimelineViewProps {
  readonly layout: TimelineLayout;
  readonly viewState: TimelineViewState;
  /** Pan/zoom; undefined = default (identity, padding offset). */
  readonly viewport?: Viewport | undefined;
  readonly onViewportChange?: ((v: Viewport) => void) | undefined;
  readonly onElementClick?: (id: string) => void;
  readonly onBackgroundClick?: () => void;
}

const PADDING = 20;

// Mermaid colours a timeline by section; periods and events inherit their
// section's hue. Same fixed palette, cycled.
const PALETTE = ["#4f82c4", "#5aab72", "#c98a3d", "#a06fbf", "#4aa3a8", "#c4636c"] as const;
const hue = (i: number): string => PALETTE[i % PALETTE.length]!;

export function TimelineView({
  layout,
  viewState,
  viewport,
  onViewportChange,
  onElementClick,
  onBackgroundClick,
}: TimelineViewProps) {
  const g = usePointerGestures({
    padding: PADDING,
    viewport,
    onViewportChange,
    dragKinds: [],
    onElementClick,
    onBackgroundClick,
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
      <g transform={`translate(${g.viewport.x} ${g.viewport.y}) scale(${g.viewport.scale})`} data-gm-root="">
        {layout.title !== undefined && layout.titlePos && (
          <text
            x={layout.titlePos.x}
            y={layout.titlePos.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={18}
            fontWeight={700}
            fontFamily="sans-serif"
            fill="var(--gm-text, #111)"
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            {layout.title}
          </text>
        )}

        {layout.sections.map((s) => (
          <g key={s.id} data-element-id={s.id} style={{ cursor: "pointer" }}>
            <rect
              x={s.rect.x}
              y={s.rect.y}
              width={s.rect.w}
              height={s.rect.h}
              rx={4}
              fill={hue(s.colorIndex)}
              fillOpacity={0.18}
              stroke={viewState.selectedId === s.id ? "var(--gm-selected, #1a73e8)" : hue(s.colorIndex)}
              strokeWidth={viewState.selectedId === s.id ? 2.5 : 1.2}
            />
            <Label
              rect={s.rect}
              text={s.name}
              fontSize={14}
              bold
              fill={hue(s.colorIndex)}
            />
          </g>
        ))}

        <line
          x1={layout.axis.x1}
          y1={layout.axis.y}
          x2={layout.axis.x2}
          y2={layout.axis.y}
          stroke="var(--gm-stroke, #666)"
          strokeWidth={2}
          style={{ pointerEvents: "none" }}
        />

        {layout.periods.map((p) => (
          <g key={p.id} data-element-id={p.id} style={{ cursor: "pointer" }}>
            <rect
              x={p.rect.x}
              y={p.rect.y}
              width={p.rect.w}
              height={p.rect.h}
              rx={6}
              fill="var(--gm-bg, #fff)"
              stroke={viewState.selectedId === p.id ? "var(--gm-selected, #1a73e8)" : hue(p.colorIndex)}
              strokeWidth={viewState.selectedId === p.id ? 2.5 : 1.6}
            />
            <Label rect={p.rect} text={p.label} fontSize={14} bold fill="var(--gm-text, #111)" />
          </g>
        ))}

        {layout.events.map((e) => (
          <g key={e.id} data-element-id={e.id} style={{ cursor: "pointer" }}>
            <rect
              x={e.rect.x}
              y={e.rect.y}
              width={e.rect.w}
              height={e.rect.h}
              rx={5}
              fill={hue(e.colorIndex)}
              fillOpacity={0.75}
              stroke={viewState.selectedId === e.id ? "var(--gm-selected, #1a73e8)" : hue(e.colorIndex)}
              strokeWidth={viewState.selectedId === e.id ? 2.5 : 1}
            />
            <Label rect={e.rect} text={e.text} fontSize={12} fill="#fff" />
          </g>
        ))}
      </g>
    </svg>
  );
}

/** Centred, `<br>`-aware label: one tspan per line (imported text keeps the
 * break as a newline). */
function Label({
  rect,
  text,
  fontSize,
  bold,
  fill,
}: {
  rect: { x: number; y: number; w: number; h: number };
  text: string;
  fontSize: number;
  bold?: boolean;
  fill: string;
}) {
  const rows = text.split("\n");
  const lineH = fontSize * 1.4;
  const top = rect.y + rect.h / 2 - ((rows.length - 1) * lineH) / 2;
  return (
    <text
      x={rect.x + rect.w / 2}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={fontSize}
      fontWeight={bold ? 700 : 400}
      fontFamily="sans-serif"
      fill={fill}
      style={{ pointerEvents: "none", userSelect: "none" }}
    >
      {rows.map((row, i) => (
        <tspan key={i} x={rect.x + rect.w / 2} y={top + i * lineH}>
          {row}
        </tspan>
      ))}
    </text>
  );
}
