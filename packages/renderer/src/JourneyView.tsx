import type { JourneyLayout, JourneyMood, JourneySectionBand, JourneyTaskBox } from "@gmermaid/layout";
import { usePointerGestures, type Viewport } from "./usePointerGestures";

export interface JourneyViewState {
  readonly selectedId?: string | undefined;
}

export interface JourneyViewProps {
  readonly layout: JourneyLayout;
  readonly viewState: JourneyViewState;
  /** Pan/zoom; undefined = default (identity, padding offset). */
  readonly viewport?: Viewport | undefined;
  readonly onViewportChange?: ((v: Viewport) => void) | undefined;
  readonly onElementClick?: (id: string) => void;
  readonly onBackgroundClick?: () => void;
}

const PADDING = 20;

// The layout only carries colour INDICES (it stays pure data), so the
// palettes live here. Actors and sections have their own so a two-actor
// journey never paints an actor the same colour as its band.
const ACTOR_COLORS = ["#4c78a8", "#f58518", "#54a24b", "#b279a2", "#e45756", "#72b7b2"];
const SECTION_COLORS = ["#dbe6f3", "#fbe4cd", "#dcecd6", "#ece0e8", "#f7dcdc", "#d9eceb"];

const pick = (palette: readonly string[], i: number) => palette[i % palette.length]!;

export function JourneyView({
  layout,
  viewState,
  viewport,
  onViewportChange,
  onElementClick,
  onBackgroundClick,
}: JourneyViewProps) {
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
            fontSize={16}
            fontWeight={600}
            fontFamily="sans-serif"
            fill="var(--gm-text, #111)"
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            {layout.title}
          </text>
        )}
        {layout.sections.map((s) => (
          <SectionView key={s.id} s={s} selected={viewState.selectedId === s.id} />
        ))}
        {layout.tasks.map((t) => (
          <TaskView key={t.id} t={t} selected={viewState.selectedId === t.id} />
        ))}
        {layout.legend.map((l) => (
          <g key={l.name}>
            <rect
              x={l.swatch.x}
              y={l.swatch.y}
              width={l.swatch.w}
              height={l.swatch.h}
              rx={3}
              fill={pick(ACTOR_COLORS, l.colorIndex)}
              stroke="var(--gm-stroke, #555)"
              strokeWidth={0.8}
            />
            <text
              x={l.textPos.x}
              y={l.textPos.y}
              dominantBaseline="central"
              fontSize={12}
              fontFamily="sans-serif"
              fill="var(--gm-text, #333)"
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              {l.name}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

function SectionView({ s, selected }: { s: JourneySectionBand; selected: boolean }) {
  const { x, y, w, h } = s.rect;
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #999)";
  return (
    <g data-element-id={s.id} style={{ cursor: "pointer" }}>
      <rect x={x} y={y} width={w} height={h} rx={4} fill={pick(SECTION_COLORS, s.colorIndex)} stroke={stroke} strokeWidth={selected ? 2.4 : 1} />
      <text
        x={x + w / 2}
        y={y + h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={13}
        fontWeight={600}
        fontFamily="sans-serif"
        fill="var(--gm-text, #333)"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {s.name}
      </text>
    </g>
  );
}

function TaskView({ t, selected }: { t: JourneyTaskBox; selected: boolean }) {
  const { x, y, w, h } = t.rect;
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : "var(--gm-stroke, #666)";
  return (
    <g data-element-id={t.id} style={{ cursor: "pointer" }}>
      <line
        x1={t.track.x}
        y1={t.track.y1}
        x2={t.track.x}
        y2={t.track.y2}
        stroke="var(--gm-stroke, #666)"
        strokeWidth={1}
        strokeDasharray="4 2"
        style={{ pointerEvents: "none" }}
      />
      <rect x={x} y={y} width={w} height={h} rx={3} fill="var(--gm-node-fill, #fff)" stroke={stroke} strokeWidth={selected ? 2.4 : 1.2} />
      <text
        x={x + w / 2}
        y={y + h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={13}
        fontFamily="sans-serif"
        fill="var(--gm-text, #111)"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {t.name}
      </text>
      {t.actors.map((a) => (
        <circle
          key={a.name}
          cx={a.center.x}
          cy={a.center.y}
          r={a.r}
          fill={pick(ACTOR_COLORS, a.colorIndex)}
          stroke="var(--gm-stroke, #555)"
          strokeWidth={0.8}
        >
          <title>{a.name}</title>
        </circle>
      ))}
      <FaceView cx={t.facePos.x} cy={t.facePos.y} r={t.faceR} mood={t.mood} score={t.score} />
    </g>
  );
}

function FaceView({ cx, cy, r, mood, score }: { cx: number; cy: number; r: number; mood: JourneyMood; score: number }) {
  // the mouth arc flips for happy/sad; neutral is a straight line
  const mouthY = cy + r * 0.3;
  const mouth =
    mood === "neutral"
      ? `M ${cx - r * 0.45} ${mouthY} L ${cx + r * 0.45} ${mouthY}`
      : mood === "happy"
        ? `M ${cx - r * 0.5} ${cy + r * 0.15} Q ${cx} ${cy + r * 0.75} ${cx + r * 0.5} ${cy + r * 0.15}`
        : `M ${cx - r * 0.5} ${cy + r * 0.55} Q ${cx} ${cy - r * 0.05} ${cx + r * 0.5} ${cy + r * 0.55}`;
  return (
    <g style={{ pointerEvents: "none" }}>
      <circle cx={cx} cy={cy} r={r} fill="var(--gm-face-fill, #ffe89e)" stroke="var(--gm-stroke, #666)" strokeWidth={1} />
      <circle cx={cx - r * 0.35} cy={cy - r * 0.25} r={r * 0.12} fill="var(--gm-stroke, #333)" />
      <circle cx={cx + r * 0.35} cy={cy - r * 0.25} r={r * 0.12} fill="var(--gm-stroke, #333)" />
      <path d={mouth} fill="none" stroke="var(--gm-stroke, #333)" strokeWidth={1.2} strokeLinecap="round" />
      <title>{`score ${score}`}</title>
    </g>
  );
}
