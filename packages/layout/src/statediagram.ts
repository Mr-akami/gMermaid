import dagre from "@dagrejs/dagre";
import type { NoteId, StateIR, StateId, StateRole, TransitionId } from "@gmermaid/ir";
import { edgeLabelSize } from "./measurer";
import type { TextMeasurer } from "./measurer";
import type { Point, Rect } from "./result";
import { clipPolylineAtRect, placeSelfLoopLabel, selfLoopPoints, SELF_LOOP_REACH } from "./compound";
import { collisionIndex } from "./collision";

const LABEL_STYLE = { fontSize: 14, fontFamily: "sans-serif" } as const;
const NOTE_STYLE = { fontSize: 12, fontFamily: "sans-serif" } as const;
const PAD_X = 16;
const PAD_Y = 10;
const MIN_W = 60;
/** [*] start/end pseudo-states render as fixed-size circles. */
const PSEUDO_SIZE = 16;
const CHOICE_SIZE = 28;
/** fork/join bars: long side across the flow direction. */
const BAR_LONG = 56;
const BAR_SHORT = 8;
const NOTE_PAD = 8;
const NOTE_GAP = 14;
// visual breathing room around a composite; the extra top holds the title
const COMP_PAD = 8;
/** Height of the title band itself — where the separator line is drawn. */
export const COMPOSITE_TITLE_BAND = 24;
/** What the frame reserves above its members: the band plus the same
 * breathing room the other three sides get, so a child never sits against
 * the title. */
const COMP_TITLE_H = COMPOSITE_TITLE_BAND + COMP_PAD;
/** breathing room around a concurrency region band inside its composite */
const REGION_PAD = 6;
/** gap between two stacked concurrency regions */
const REGION_GAP = 18;

const regionOf = (s: { region?: number }): number => s.region ?? 0;
/** Synthetic cluster id for a region — layout-only, in a namespace the IR
 * cannot collide with (state ids reject `-`). */
const regionClusterId = (parent: StateId, index: number): string => `region-${parent}-${index}`;

export interface StateBox {
  readonly id: StateId;
  readonly label: string;
  readonly role: StateRole;
  readonly rect: Rect;
  /** True when the box is a composite frame (drawn behind its children). */
  readonly composite: boolean;
  /** Nesting depth (0 = top level) — outer frames draw first. */
  readonly depth: number;
}

/** One concurrency region of a composite. Regions are layout-only: the IR
 * stores a region INDEX per member, never a container object. */
export interface StateRegionBand {
  readonly parent: StateId;
  readonly index: number;
  readonly rect: Rect;
}

/** Dashed `--` divider drawn between two adjacent regions. */
export interface RegionSeparator {
  readonly parent: StateId;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface TransitionPath {
  readonly id: TransitionId;
  readonly points: readonly Point[];
  readonly label?: string;
  readonly labelPos?: Point;
}

export interface StateNoteBox {
  readonly id: NoteId;
  readonly rect: Rect;
  readonly text: string;
  readonly anchor: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number };
}

export interface StateLayout {
  readonly kind: "state";
  readonly size: { readonly w: number; readonly h: number };
  readonly states: readonly StateBox[];
  readonly transitions: readonly TransitionPath[];
  readonly notes: readonly StateNoteBox[];
  readonly regions: readonly StateRegionBand[];
  readonly regionSeparators: readonly RegionSeparator[];
}

export function layoutStateDiagram(ir: StateIR, measure: TextMeasurer): StateLayout {
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: true });
  const horizontal = ir.direction === "LR" || ir.direction === "RL";
  // Per-block `direction` (StateNode.direction) is round-trip-only: dagre has
  // one rankdir for the whole graph and no per-cluster override, so honoring
  // it would mean laying each composite out in its own sub-graph and pasting
  // the result back. Kept in the IR, emitted by codegen, ignored here.
  g.setGraph({ rankdir: ir.direction ?? "TB", nodesep: 40, ranksep: 50 });
  g.setDefaultEdgeLabel(() => ({}));

  const childCount = new Map<StateId, number>();
  for (const s of ir.states) if (s.parent !== undefined) childCount.set(s.parent, (childCount.get(s.parent) ?? 0) + 1);
  const isComposite = (id: StateId): boolean => (childCount.get(id) ?? 0) > 0;
  /** Region indices actually used inside a composite, ascending. */
  const regionsOf = (id: StateId): number[] =>
    [...new Set(ir.states.filter((s) => s.parent === id).map(regionOf))].toSorted((a, b) => a - b);

  for (const s of ir.states) {
    if (isComposite(s.id)) {
      g.setNode(s.id, {});
      continue;
    }
    if (s.role === "start" || s.role === "end") {
      g.setNode(s.id, { width: PSEUDO_SIZE, height: PSEUDO_SIZE });
    } else if (s.role === "choice") {
      g.setNode(s.id, { width: CHOICE_SIZE, height: CHOICE_SIZE });
    } else if (s.role === "fork" || s.role === "join") {
      g.setNode(s.id, {
        width: horizontal ? BAR_SHORT : BAR_LONG,
        height: horizontal ? BAR_LONG : BAR_SHORT,
      });
    } else {
      const m = measure.measure(s.label, LABEL_STYLE);
      g.setNode(s.id, { width: Math.max(MIN_W, m.w + PAD_X * 2), height: m.h + PAD_Y * 2 });
    }
  }

  // A concurrency region becomes a synthetic dagre cluster nested in the
  // composite. A composite with a single region gets none: the extra cluster
  // would only add padding.
  const regionClusters: { parent: StateId; index: number; id: string }[] = [];
  for (const s of ir.states) {
    if (!isComposite(s.id)) continue;
    const regions = regionsOf(s.id);
    if (regions.length < 2) continue;
    for (const index of regions) {
      const id = regionClusterId(s.id, index);
      g.setNode(id, {});
      g.setParent(id, s.id);
      regionClusters.push({ parent: s.id, index, id });
    }
  }
  const containerOf = (s: { id: StateId; parent?: StateId; region?: number }): string | undefined => {
    if (s.parent === undefined) return undefined;
    const cluster = regionClusterId(s.parent, regionOf(s));
    return g.hasNode(cluster) ? cluster : s.parent;
  };
  for (const s of ir.states) {
    const container = containerOf(s);
    if (container !== undefined) g.setParent(s.id, container);
  }

  // dagre cannot attach edges to clusters: route them to a representative
  // leaf inside, and clip the drawn path at the composite border afterwards
  const representative = (id: StateId): StateId => {
    const start = ir.states.find((s) => s.parent === id && s.role === "start");
    const child = start ?? ir.states.find((s) => s.parent === id);
    if (!child) throw new Error(`layoutStateDiagram: composite ${id} has no members`);
    return isComposite(child.id) ? representative(child.id) : child.id;
  };
  const anchor = (id: StateId): StateId => (isComposite(id) ? representative(id) : id);

  for (const t of ir.transitions) {
    if (!g.hasNode(t.from) || !g.hasNode(t.to)) {
      throw new Error(`layoutStateDiagram: transition ${t.id} references a missing state`);
    }
    // dagre cannot route self-edges — synthesized after layout as a detour
    // off the box's right side (same geometry as class self-relations)
    if (t.from !== t.to) g.setEdge(anchor(t.from), anchor(t.to), edgeLabelSize(t.label, measure, LABEL_STYLE), t.id);
  }

  // Regions stack along the flow axis: an invisible, zero-weight edge between
  // consecutive region representatives is the only lever dagre offers for
  // ordering sibling clusters.
  const regionRep = (parent: StateId, index: number): StateId | undefined => {
    const member = ir.states.find((s) => s.parent === parent && regionOf(s) === index);
    if (!member) return undefined;
    return isComposite(member.id) ? representative(member.id) : member.id;
  };
  for (const s of ir.states) {
    if (!isComposite(s.id)) continue;
    const regions = regionsOf(s.id);
    for (let i = 1; i < regions.length; i++) {
      const a = regionRep(s.id, regions[i - 1]!);
      const b = regionRep(s.id, regions[i]!);
      if (a !== undefined && b !== undefined) g.setEdge(a, b, { weight: 0 }, `region-order-${s.id}-${i}`);
    }
  }

  dagre.layout(g);

  const depth = (s: { parent?: StateId }): number => {
    let d = 0;
    let cur = s.parent;
    while (cur !== undefined) {
      d += 1;
      cur = ir.states.find((x) => x.id === cur)?.parent;
    }
    return d;
  };

  // Leaf boxes come straight from dagre; composite frames are rebuilt from
  // their members below, because the region pass moves those members.
  const leafRect = new Map<StateId, Rect>();
  for (const s of ir.states) {
    if (isComposite(s.id)) continue;
    const pos = g.node(s.id);
    leafRect.set(s.id, { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2, w: pos.width, h: pos.height });
  }

  const childrenOf = new Map<StateId, StateId[]>();
  for (const s of ir.states) {
    if (s.parent === undefined) continue;
    childrenOf.set(s.parent, [...(childrenOf.get(s.parent) ?? []), s.id]);
  }
  const leavesUnder = (id: StateId): StateId[] =>
    isComposite(id) ? (childrenOf.get(id) ?? []).flatMap(leavesUnder) : [id];
  const bboxOf = (ids: readonly StateId[]): Rect | undefined => {
    const rects = ids.flatMap(leavesUnder).map((x) => leafRect.get(x)!);
    if (rects.length === 0) return undefined;
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    return {
      x,
      y,
      w: Math.max(...rects.map((r) => r.x + r.w)) - x,
      h: Math.max(...rects.map((r) => r.y + r.h)) - y,
    };
  };

  // Dagre ranks sibling clusters freely, so two regions of one composite can
  // land side by side and overlap. Push them apart along the flow axis
  // (innermost composite first, so an outer pass sees final inner geometry)
  // and remember the delta, which the edge paths need too.
  const moved = new Map<StateId, Point>();
  const shiftSubtree = (root: StateId, dx: number, dy: number): void => {
    for (const leaf of leavesUnder(root)) {
      const r = leafRect.get(leaf)!;
      leafRect.set(leaf, { ...r, x: r.x + dx, y: r.y + dy });
      const prev = moved.get(leaf) ?? { x: 0, y: 0 };
      moved.set(leaf, { x: prev.x + dx, y: prev.y + dy });
    }
  };
  const composites = ir.states.filter((s) => isComposite(s.id)).toSorted((a, b) => depth(b) - depth(a));
  for (const comp of composites) {
    const regions = regionsOf(comp.id);
    if (regions.length < 2) continue;
    const membersOf = (index: number) => ir.states.filter((x) => x.parent === comp.id && regionOf(x) === index).map((x) => x.id);
    for (let i = 1; i < regions.length; i++) {
      const prev = bboxOf(membersOf(regions[i - 1]!));
      const cur = bboxOf(membersOf(regions[i]!));
      if (!prev || !cur) continue;
      const delta = horizontal ? prev.x + prev.w + REGION_GAP - cur.x : prev.y + prev.h + REGION_GAP - cur.y;
      if (delta <= 0) continue;
      for (const id of membersOf(regions[i]!)) shiftSubtree(id, horizontal ? delta : 0, horizontal ? 0 : delta);
    }
  }

  const rectOf = new Map<StateId, Rect>();
  const frameOf = (id: StateId): Rect => {
    const cached = rectOf.get(id);
    if (cached) return cached;
    const leaf = leafRect.get(id);
    const rect =
      leaf ??
      (() => {
        // a frame wraps its members, with extra room on top for the title
        const inner = bboxOf(childrenOf.get(id) ?? [])!;
        return {
          x: inner.x - COMP_PAD,
          y: inner.y - COMP_TITLE_H,
          w: inner.w + COMP_PAD * 2,
          h: inner.h + COMP_TITLE_H + COMP_PAD,
        };
      })();
    rectOf.set(id, rect);
    return rect;
  };
  for (const s of ir.states) frameOf(s.id);

  const states: StateBox[] = ir.states.map((s) => ({
    id: s.id,
    label: s.label,
    role: s.role,
    rect: rectOf.get(s.id)!,
    composite: isComposite(s.id),
    depth: depth(s),
  }));

  // region bands: the members' bbox, widened across the flow axis to the
  // composite frame so the `--` divider spans it like mermaid draws it
  const regions: StateRegionBand[] = regionClusters.flatMap(({ parent, index }) => {
    const inner = bboxOf(ir.states.filter((x) => x.parent === parent && regionOf(x) === index).map((x) => x.id));
    if (!inner) return [];
    const frame = rectOf.get(parent)!;
    const band = { x: inner.x - REGION_PAD, y: inner.y - REGION_PAD, w: inner.w + REGION_PAD * 2, h: inner.h + REGION_PAD * 2 };
    return [
      {
        parent,
        index,
        rect: horizontal
          ? { x: band.x, y: frame.y + COMPOSITE_TITLE_BAND, w: band.w, h: frame.y + frame.h - (frame.y + COMPOSITE_TITLE_BAND) }
          : { x: frame.x, y: band.y, w: frame.w, h: band.h },
      },
    ];
  });

  const regionSeparators: RegionSeparator[] = [];
  for (const s of ir.states) {
    const bands = regions.filter((r) => r.parent === s.id).toSorted((a, b) => a.index - b.index);
    const frame = rectOf.get(s.id)!;
    for (let i = 1; i < bands.length; i++) {
      const prev = bands[i - 1]!.rect;
      const next = bands[i]!.rect;
      if (horizontal) {
        const x = (prev.x + prev.w + next.x) / 2;
        regionSeparators.push({ parent: s.id, x1: x, y1: frame.y + COMPOSITE_TITLE_BAND, x2: x, y2: frame.y + frame.h });
      } else {
        const y = (prev.y + prev.h + next.y) / 2;
        regionSeparators.push({ parent: s.id, x1: frame.x, y1: y, x2: frame.x + frame.w, y2: y });
      }
    }
  }

  // notes sit beside their target, outside the dagre graph
  const notes: StateNoteBox[] = [];
  for (const n of ir.notes) {
    const target = rectOf.get(n.target);
    if (!target) continue;
    // multi-line note text: widest line decides the width, the line count
    // the height (the renderer draws one tspan per line)
    const textLines = n.text.split("\n");
    const measured = textLines.map((l) => measure.measure(l, NOTE_STYLE));
    const w = Math.max(...measured.map((m) => m.w)) + NOTE_PAD * 2;
    const lineH = measured[0]!.h;
    const h = Math.max(26, lineH * textLines.length + NOTE_PAD * 2);
    const y = target.y + target.h / 2 - h / 2;
    const x = n.position === "rightOf" ? target.x + target.w + NOTE_GAP : target.x - NOTE_GAP - w;
    const anchorX = n.position === "rightOf" ? target.x + target.w : target.x;
    notes.push({
      id: n.id,
      rect: { x, y, w, h },
      text: n.text,
      anchor: {
        x1: n.position === "rightOf" ? x : x + w,
        y1: y + h / 2,
        x2: anchorX,
        y2: target.y + target.h / 2,
      },
    });
  }

  // stacked self-transitions on one state fan outward by index
  const selfCount = new Map<StateId, number>();
  let selfMaxRight = 0;
  // dagre reserved room for the labels on the edges it routed; a self-loop is
  // drawn afterwards, next to whatever already sits on that side of the box.
  const taken = collisionIndex([...states.filter((s) => !s.composite).map((s) => s.rect), ...notes.map((n) => n.rect)]);

  const transitions: TransitionPath[] = ir.transitions.map((t) => {
    if (t.from === t.to) {
      const rect = rectOf.get(t.from)!;
      const k = selfCount.get(t.from) ?? 0;
      selfCount.set(t.from, k + 1);
      const points = selfLoopPoints(rect, k);
      const reach = rect.x + rect.w + SELF_LOOP_REACH(k);
      const cy = points[1]!.y + (points[2]!.y - points[1]!.y) / 2;
      if (t.label === undefined) {
        selfMaxRight = Math.max(selfMaxRight, reach);
        return { id: t.id, points };
      }
      const spot = placeSelfLoopLabel(taken, rect, reach, cy, measure.measure(t.label, NOTE_STYLE));
      selfMaxRight = Math.max(selfMaxRight, spot.right + 6);
      return { id: t.id, points, label: t.label, labelPos: spot.labelPos };
    }
    const e = g.edge(anchor(t.from), anchor(t.to), t.id);
    let points: Point[] = e.points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y }));
    // a region shift moved the endpoints out from under dagre's route: carry
    // the whole path when both ends moved together, otherwise just re-attach
    // the moved end (the elbow in between stays where dagre put it)
    const fromShift = moved.get(anchor(t.from));
    const toShift = moved.get(anchor(t.to));
    const same = fromShift !== undefined && toShift !== undefined && fromShift.x === toShift.x && fromShift.y === toShift.y;
    if (same) points = points.map((p) => ({ x: p.x + fromShift.x, y: p.y + fromShift.y }));
    else {
      if (fromShift) points[0] = { x: points[0]!.x + fromShift.x, y: points[0]!.y + fromShift.y };
      if (toShift) points[points.length - 1] = { x: points.at(-1)!.x + toShift.x, y: points.at(-1)!.y + toShift.y };
    }
    if (isComposite(t.to)) points = clipPolylineAtRect(points, rectOf.get(t.to)!, "to");
    if (isComposite(t.from)) points = clipPolylineAtRect(points, rectOf.get(t.from)!, "from");
    const mid = points[Math.floor(points.length / 2)]!;
    return {
      id: t.id,
      points,
      ...(t.label !== undefined
        ? {
            label: t.label,
            labelPos: typeof e.x === "number" && typeof e.y === "number" ? { x: e.x, y: e.y } : { x: mid.x, y: mid.y - 6 },
          }
        : {}),
    };
  });

  const graph = g.graph();
  // dagre reports -Infinity for an empty graph — clamp to a sane empty canvas
  let w = graph.width !== undefined && Number.isFinite(graph.width) ? graph.width : 200;
  let h = graph.height !== undefined && Number.isFinite(graph.height) ? graph.height : 100;
  // self-loop detours (and their labels) stick out past dagre's extent
  w = Math.max(w, selfMaxRight);
  for (const s of states) {
    w = Math.max(w, s.rect.x + s.rect.w);
    h = Math.max(h, s.rect.y + s.rect.h);
  }
  for (const n of notes) {
    w = Math.max(w, n.rect.x + n.rect.w);
    h = Math.max(h, n.rect.y + n.rect.h);
  }
  return { kind: "state", size: { w, h }, states, transitions, notes, regions, regionSeparators };
}
