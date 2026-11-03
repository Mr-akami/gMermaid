import type { GitCommitNode, GitGraphLayout } from "@gmermaid/layout";
import { usePointerGestures, type Viewport, type SelectionGestures } from "./usePointerGestures";
import { MarqueeRect, selectionOf } from "./Marquee";

export interface GitGraphViewState {
  readonly selectedId?: string | undefined;
  /** The whole selection; `selectedId` is always one of these. */
  readonly selectedIds?: readonly string[] | undefined;
}

export interface GitGraphViewProps {
  readonly layout: GitGraphLayout;
  readonly viewState: GitGraphViewState;
  /** Pan/zoom; undefined = default (identity, padding offset). */
  readonly viewport?: Viewport | undefined;
  readonly onViewportChange?: ((v: Viewport) => void) | undefined;
  /** `additive` = Ctrl/Cmd/Shift was held: add to the selection. */
  readonly onElementClick?: (id: string, additive: boolean) => void;
  readonly onBackgroundClick?: () => void;
  /** Marquee and context-menu gestures (see SelectionGestures). */
  readonly select?: SelectionGestures | undefined;
}

const PADDING = 20;

// One hue per lane (branch), cycled — mermaid colours its branches the same
// way.
const PALETTE = ["#4f82c4", "#5aab72", "#c98a3d", "#a06fbf", "#4aa3a8", "#c4636c", "#8a8f3c", "#7a7fd0"] as const;
const hue = (i: number): string => PALETTE[i % PALETTE.length]!;

export function GitGraphView({
  layout,
  viewState,
  viewport,
  onViewportChange,
  onElementClick,
  onBackgroundClick,
  select,
}: GitGraphViewProps) {
  const sel = selectionOf(viewState);
  const g = usePointerGestures({
    padding: PADDING,
    viewport,
    onViewportChange,
    dragKinds: [],
    onElementClick,
    onBackgroundClick,
    selection: select,
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
        {layout.lanes.map((l) => (
          <line
            key={`guide-${l.id}`}
            x1={l.line.from.x}
            y1={l.line.from.y}
            x2={l.line.to.x}
            y2={l.line.to.y}
            stroke={hue(l.colorIndex)}
            strokeOpacity={0.45}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            style={{ pointerEvents: "none" }}
          />
        ))}

        {layout.edges.map((e) => (
          <path
            key={`${e.from}>${e.to}`}
            d={e.d}
            fill="none"
            stroke={hue(e.colorIndex)}
            strokeWidth={3}
            strokeDasharray={e.dashed ? "6 4" : undefined}
            strokeLinecap="round"
            style={{ pointerEvents: "none" }}
          />
        ))}

        {layout.lanes.map((l) => (
          <g key={l.id} data-element-id={l.id} style={{ cursor: "pointer" }}>
            <rect
              x={l.rect.x}
              y={l.rect.y}
              width={l.rect.w}
              height={l.rect.h}
              rx={l.rect.h / 2}
              fill={hue(l.colorIndex)}
              fillOpacity={0.18}
              stroke={sel.has(l.id) ? "var(--gm-selected, #1a73e8)" : hue(l.colorIndex)}
              strokeWidth={sel.has(l.id) ? 2.5 : 1.4}
            />
            <text
              x={l.rect.x + l.rect.w / 2}
              y={l.rect.y + l.rect.h / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={12}
              fontWeight={700}
              fontFamily="sans-serif"
              fill="var(--gm-text, #111)"
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              {l.name}
            </text>
          </g>
        ))}

        {layout.commits.map((c) => (
          <g key={c.id} data-element-id={c.id} style={{ cursor: "pointer" }}>
            <CommitMark c={c} selected={sel.has(c.id)} />
            {c.tagRect && (
              <g style={{ pointerEvents: "none" }}>
                <rect
                  x={c.tagRect.x}
                  y={c.tagRect.y}
                  width={c.tagRect.w}
                  height={c.tagRect.h}
                  rx={3}
                  fill="var(--gm-bg, #fff)"
                  stroke={hue(c.colorIndex)}
                  strokeWidth={1}
                />
                <text
                  x={c.tagRect.x + c.tagRect.w / 2}
                  y={c.tagRect.y + c.tagRect.h / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={10}
                  fontFamily="sans-serif"
                  fill="var(--gm-text, #111)"
                  style={{ userSelect: "none" }}
                >
                  {c.tags}
                </text>
              </g>
            )}
            {c.label !== "" && (
              <text
                x={c.labelPos.x}
                y={c.labelPos.y}
                textAnchor={c.labelAnchor}
                dominantBaseline="central"
                fontSize={11}
                fontFamily="sans-serif"
                fill="var(--gm-text, #111)"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {c.label}
              </text>
            )}
          </g>
        ))}
      </g>
      {g.band !== undefined && (
        <g transform={`translate(${g.viewport.x} ${g.viewport.y}) scale(${g.viewport.scale})`}>
          <MarqueeRect band={g.band} />
        </g>
      )}
    </svg>
  );
}

/** The four commit looks mermaid draws: plain dot, highlighted square,
 * reversed (crossed) dot, merge (ringed) — plus a cherry-pick's two cherries. */
function CommitMark({ c, selected }: { c: GitCommitNode; selected: boolean }) {
  const { x, y } = c.center;
  const r = c.r;
  const color = hue(c.colorIndex);
  const stroke = selected ? "var(--gm-selected, #1a73e8)" : color;
  const sw = selected ? 3 : 2;

  if (c.kind === "commit" && c.commitType === "HIGHLIGHT") {
    return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} rx={2} fill={color} stroke={stroke} strokeWidth={sw} />;
  }
  if (c.kind === "commit" && c.commitType === "REVERSE") {
    const d = r * 0.55;
    return (
      <g>
        <circle cx={x} cy={y} r={r} fill="var(--gm-bg, #fff)" stroke={stroke} strokeWidth={sw} />
        <path d={`M ${x - d} ${y - d} L ${x + d} ${y + d} M ${x - d} ${y + d} L ${x + d} ${y - d}`} stroke={color} strokeWidth={2} />
      </g>
    );
  }
  if (c.kind === "merge") {
    return (
      <g>
        <circle cx={x} cy={y} r={r} fill="var(--gm-bg, #fff)" stroke={stroke} strokeWidth={sw} />
        <circle cx={x} cy={y} r={r * 0.5} fill={c.commitType === "HIGHLIGHT" ? color : "var(--gm-bg, #fff)"} stroke={color} strokeWidth={2} />
      </g>
    );
  }
  if (c.kind === "cherryPick") {
    return (
      <g>
        <circle cx={x} cy={y} r={r} fill={color} stroke={stroke} strokeWidth={sw} />
        <circle cx={x - 3} cy={y + 3} r={2.2} fill="#fff" />
        <circle cx={x + 3} cy={y + 3} r={2.2} fill="#fff" />
        <path d={`M ${x - 3} ${y + 1} L ${x} ${y - 4} L ${x + 3} ${y + 1}`} fill="none" stroke="#fff" strokeWidth={1.2} />
      </g>
    );
  }
  return <circle cx={x} cy={y} r={r} fill={color} stroke={stroke} strokeWidth={sw} />;
}
