import dagre from "@dagrejs/dagre";
import type { NoteId, StateDirection, StateIR, StateId, StateNode, StateRole, TransitionId } from "@gmermaid/ir";
import { edgeLabelSize } from "./measurer";
import type { TextMeasurer } from "./measurer";
import type { Point, Rect } from "./result";
import { placeSelfLoopLabel, selfLoopPoints, SELF_LOOP_REACH } from "./compound";
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
const NODE_SEP = 40;
const RANK_SEP = 50;
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
/** Map key for "no parent" — state ids are never empty. */
const ROOT = "";

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

/** A routed path in the coordinates of the container that produced it. */
interface RoutedEdge {
  points: Point[];
  labelPos?: Point;
}

/**
 * One container laid out on its own — the root diagram, or the inside of one
 * composite. Coordinates are local: the container's frame sits at (0,0).
 */
interface SubLayout {
  readonly w: number;
  readonly h: number;
  /** every descendant, not the container itself */
  readonly rects: Map<StateId, Rect>;
  readonly paths: Map<TransitionId, RoutedEdge>;
  readonly regions: StateRegionBand[];
  readonly separators: RegionSeparator[];
}

const bboxOf = (rects: readonly Rect[]): Rect => {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    w: Math.max(...rects.map((r) => r.x + r.w)) - x,
    h: Math.max(...rects.map((r) => r.y + r.h)) - y,
  };
};

export function layoutStateDiagram(ir: StateIR, measure: TextMeasurer): StateLayout {
  const byId = new Map<StateId, StateNode>(ir.states.map((s) => [s.id, s]));
  const childrenOf = new Map<string, StateNode[]>();
  for (const s of ir.states) {
    const key = s.parent ?? ROOT;
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), s]);
  }
  const isComposite = (id: StateId): boolean => (childrenOf.get(id)?.length ?? 0) > 0;

  const depth = (s: StateNode): number => {
    let d = 0;
    let cur = s.parent;
    while (cur !== undefined) {
      d += 1;
      cur = byId.get(cur)?.parent;
    }
    return d;
  };

  for (const t of ir.transitions) {
    if (!byId.has(t.from) || !byId.has(t.to)) {
      throw new Error(`layoutStateDiagram: transition ${t.id} references a missing state`);
    }
  }

  // Which container a transition belongs to: the deepest composite (or the
  // root) that holds both ends. Inside it the edge runs between the two DIRECT
  // children that contain the ends, so an edge reaching into a composite ends
  // on that composite's box — dagre does the clipping by itself, because the
  // box is a real node here rather than a cluster.
  const containersOf = (id: StateId): (StateId | undefined)[] => {
    const chain: (StateId | undefined)[] = [];
    let cur = byId.get(id)?.parent;
    while (cur !== undefined) {
      chain.push(cur);
      cur = byId.get(cur)?.parent;
    }
    chain.push(undefined);
    return chain;
  };
  const liftTo = (id: StateId, container: StateId | undefined): StateId => {
    let cur = id;
    while (byId.get(cur)?.parent !== container) cur = byId.get(cur)!.parent!;
    return cur;
  };

  interface PlacedEdge {
    readonly id: TransitionId;
    readonly label?: string;
    readonly from: StateId;
    readonly to: StateId;
  }
  const edgesIn = new Map<string, PlacedEdge[]>();
  /** Transitions between a composite and something inside it: there is no
   * container where the two are siblings, so they are drawn by hand.
   * `outward` = the edge leaves the enclosing frame for a box inside it. */
  const nested = new Map<TransitionId, boolean>();
  for (const t of ir.transitions) {
    if (t.from === t.to) continue; // self-transition: a detour drawn afterwards
    const outer = containersOf(t.to);
    const container = containersOf(t.from).find((c) => outer.includes(c));
    const from = liftTo(t.from, container);
    const to = liftTo(t.to, container);
    if (from === to) {
      nested.set(t.id, containersOf(t.to).includes(t.from));
      continue;
    }
    const key = container ?? ROOT;
    edgesIn.set(key, [...(edgesIn.get(key) ?? []), { id: t.id, from, to, ...(t.label !== undefined ? { label: t.label } : {}) }]);
  }

  const leafSize = (s: StateNode, horizontal: boolean): { width: number; height: number } => {
    if (s.role === "start" || s.role === "end") return { width: PSEUDO_SIZE, height: PSEUDO_SIZE };
    if (s.role === "choice") return { width: CHOICE_SIZE, height: CHOICE_SIZE };
    if (s.role === "fork" || s.role === "join") {
      return { width: horizontal ? BAR_SHORT : BAR_LONG, height: horizontal ? BAR_LONG : BAR_SHORT };
    }
    const m = measure.measure(s.label, LABEL_STYLE);
    return { width: Math.max(MIN_W, m.w + PAD_X * 2), height: m.h + PAD_Y * 2 };
  };

  /**
   * Lay out everything directly inside `container` (undefined = the diagram)
   * in a dagre graph of its own, innermost first. A composite child enters as
   * a single node the size of its finished contents, so dagre never sees a
   * cluster more than one level deep and the rank separation stops growing
   * with nesting depth. The private graph is also what lets a composite honour
   * its own `direction`.
   */
  const layoutContainer = (container: StateId | undefined, dir: StateDirection): SubLayout => {
    const kids = childrenOf.get(container ?? ROOT) ?? [];
    const horizontal = dir === "LR" || dir === "RL";
    const g = new dagre.graphlib.Graph({ multigraph: true, compound: true });
    g.setGraph({ rankdir: dir, nodesep: NODE_SEP, ranksep: RANK_SEP });
    g.setDefaultEdgeLabel(() => ({}));

    const subs = new Map<StateId, SubLayout>();
    for (const k of kids) {
      if (isComposite(k.id)) {
        const sub = layoutContainer(k.id, k.direction ?? dir);
        subs.set(k.id, sub);
        g.setNode(k.id, { width: sub.w, height: sub.h });
      } else {
        g.setNode(k.id, leafSize(k, horizontal));
      }
    }

    // A concurrency region becomes a synthetic dagre cluster. It is the only
    // cluster this graph ever has: composites are plain nodes here.
    const regionIndices = [...new Set(kids.map(regionOf))].toSorted((a, b) => a - b);
    const banded = container !== undefined && regionIndices.length > 1;
    if (banded) {
      for (const index of regionIndices) {
        g.setNode(regionClusterId(container, index), {});
      }
      for (const k of kids) g.setParent(k.id, regionClusterId(container, regionOf(k)));
    }

    const edges = edgesIn.get(container ?? ROOT) ?? [];
    for (const e of edges) g.setEdge(e.from, e.to, edgeLabelSize(e.label, measure, LABEL_STYLE), e.id);

    // Regions stack along the flow axis: an invisible, zero-weight edge between
    // consecutive region members is the only lever dagre offers for ordering
    // sibling clusters.
    if (banded) {
      for (let i = 1; i < regionIndices.length; i++) {
        const a = kids.find((k) => regionOf(k) === regionIndices[i - 1]);
        const b = kids.find((k) => regionOf(k) === regionIndices[i]);
        if (a && b) g.setEdge(a.id, b.id, { weight: 0 }, `region-order-${container}-${i}`);
      }
    }

    dagre.layout(g);

    const local = new Map<StateId, Rect>();
    for (const k of kids) {
      const p = g.node(k.id);
      local.set(k.id, { x: p.x - p.width / 2, y: p.y - p.height / 2, w: p.width, h: p.height });
    }

    // Dagre ranks sibling clusters freely, so two regions of one composite can
    // land side by side and overlap. Push them apart along the flow axis and
    // remember the delta, which the edge paths need too.
    const moved = new Map<StateId, Point>();
    if (banded) {
      const membersOf = (index: number) => kids.filter((k) => regionOf(k) === index).map((k) => k.id);
      for (let i = 1; i < regionIndices.length; i++) {
        const prev = bboxOf(membersOf(regionIndices[i - 1]!).map((id) => local.get(id)!));
        const cur = bboxOf(membersOf(regionIndices[i]!).map((id) => local.get(id)!));
        const delta = horizontal ? prev.x + prev.w + REGION_GAP - cur.x : prev.y + prev.h + REGION_GAP - cur.y;
        if (delta <= 0) continue;
        for (const id of membersOf(regionIndices[i]!)) {
          const r = local.get(id)!;
          const d = horizontal ? { x: delta, y: 0 } : { x: 0, y: delta };
          local.set(id, { ...r, x: r.x + d.x, y: r.y + d.y });
          moved.set(id, d);
        }
      }
    }

    const paths = new Map<TransitionId, RoutedEdge>();
    for (const e of edges) {
      const dagreEdge = g.edge(e.from, e.to, e.id);
      let points: Point[] = dagreEdge.points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y }));
      // a region shift moved the endpoints out from under dagre's route: carry
      // the whole path when both ends moved together, otherwise just re-attach
      // the moved end (the elbow in between stays where dagre put it)
      const fromShift = moved.get(e.from);
      const toShift = moved.get(e.to);
      const same = fromShift !== undefined && toShift !== undefined && fromShift.x === toShift.x && fromShift.y === toShift.y;
      if (same) points = points.map((p) => ({ x: p.x + fromShift.x, y: p.y + fromShift.y }));
      else {
        if (fromShift) points[0] = { x: points[0]!.x + fromShift.x, y: points[0]!.y + fromShift.y };
        if (toShift) points[points.length - 1] = { x: points.at(-1)!.x + toShift.x, y: points.at(-1)!.y + toShift.y };
      }
      const mid = points[Math.floor(points.length / 2)]!;
      const labelPos =
        typeof dagreEdge.x === "number" && typeof dagreEdge.y === "number"
          ? { x: dagreEdge.x + (same && fromShift ? fromShift.x : 0), y: dagreEdge.y + (same && fromShift ? fromShift.y : 0) }
          : { x: mid.x, y: mid.y - 6 };
      paths.set(e.id, { points, ...(e.label !== undefined ? { labelPos } : {}) });
    }

    // The frame wraps its DIRECT children — a composite child by its finished
    // box, not by the leaves inside it — so every level insets by its own
    // padding and its title band stays clear.
    const graph = g.graph();
    const boxes = kids.map((k) => local.get(k.id)!);
    const inner = boxes.length > 0 ? bboxOf(boxes) : { x: 0, y: 0, w: 0, h: 0 };
    const framed = container !== undefined;
    const offX = framed ? COMP_PAD - inner.x : 0;
    const offY = framed ? COMP_TITLE_H - inner.y : 0;
    const w = framed
      ? inner.w + COMP_PAD * 2
      : graph.width !== undefined && Number.isFinite(graph.width)
        ? graph.width
        : 200;
    const h = framed
      ? inner.h + COMP_TITLE_H + COMP_PAD
      : graph.height !== undefined && Number.isFinite(graph.height)
        ? graph.height
        : 100;

    const rects = new Map<StateId, Rect>();
    const regions: StateRegionBand[] = [];
    const separators: RegionSeparator[] = [];
    const placed = new Map<StateId, Rect>();
    for (const k of kids) {
      const r = local.get(k.id)!;
      placed.set(k.id, { ...r, x: r.x + offX, y: r.y + offY });
    }

    if (banded) {
      const bands = regionIndices.map((index) => {
        const box = bboxOf(kids.filter((k) => regionOf(k) === index).map((k) => placed.get(k.id)!));
        // the band spans the frame across the flow axis, so the `--` divider
        // reaches both borders the way mermaid draws it
        const rect = horizontal
          ? { x: box.x - REGION_PAD, y: COMPOSITE_TITLE_BAND, w: box.w + REGION_PAD * 2, h: h - COMPOSITE_TITLE_BAND }
          : { x: 0, y: box.y - REGION_PAD, w, h: box.h + REGION_PAD * 2 };
        return { parent: container!, index, rect };
      });
      regions.push(...bands);
      for (let i = 1; i < bands.length; i++) {
        const prev = bands[i - 1]!.rect;
        const next = bands[i]!.rect;
        if (horizontal) {
          const x = (prev.x + prev.w + next.x) / 2;
          separators.push({ parent: container!, x1: x, y1: COMPOSITE_TITLE_BAND, x2: x, y2: h });
        } else {
          const y = (prev.y + prev.h + next.y) / 2;
          separators.push({ parent: container!, x1: 0, y1: y, x2: w, y2: y });
        }
      }
    }

    for (const [id, p] of paths) {
      paths.set(id, {
        points: p.points.map((q) => ({ x: q.x + offX, y: q.y + offY })),
        ...(p.labelPos ? { labelPos: { x: p.labelPos.x + offX, y: p.labelPos.y + offY } } : {}),
      });
    }

    // paste each composite child's own layout in behind its box
    for (const k of kids) {
      const box = placed.get(k.id)!;
      rects.set(k.id, box);
      const sub = subs.get(k.id);
      if (!sub) continue;
      for (const [id, r] of sub.rects) rects.set(id, { ...r, x: r.x + box.x, y: r.y + box.y });
      for (const [id, p] of sub.paths) {
        paths.set(id, {
          points: p.points.map((q) => ({ x: q.x + box.x, y: q.y + box.y })),
          ...(p.labelPos ? { labelPos: { x: p.labelPos.x + box.x, y: p.labelPos.y + box.y } } : {}),
        });
      }
      for (const b of sub.regions) regions.push({ ...b, rect: { ...b.rect, x: b.rect.x + box.x, y: b.rect.y + box.y } });
      for (const s of sub.separators) {
        separators.push({ ...s, x1: s.x1 + box.x, y1: s.y1 + box.y, x2: s.x2 + box.x, y2: s.y2 + box.y });
      }
    }

    return { w, h, rects, paths, regions, separators };
  };

  const root = layoutContainer(undefined, ir.direction ?? "TB");
  const rectOf = root.rects;

  const states: StateBox[] = ir.states.map((s) => ({
    id: s.id,
    label: s.label,
    role: s.role,
    rect: rectOf.get(s.id)!,
    composite: isComposite(s.id),
    depth: depth(s),
  }));

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
    // a composite reaching into itself has no container where the two ends are
    // siblings: drop a straight connector down the inner box's centre line
    if (nested.has(t.id)) {
      const from = rectOf.get(t.from)!;
      const to = rectOf.get(t.to)!;
      const outward = nested.get(t.id)!;
      const x = outward ? to.x + to.w / 2 : from.x + from.w / 2;
      const points = outward
        ? [
            { x, y: from.y },
            { x, y: to.y },
          ]
        : [
            { x, y: from.y + from.h },
            { x, y: to.y + to.h },
          ];
      return { id: t.id, points, ...(t.label !== undefined ? { label: t.label, labelPos: { x: x + 6, y: (points[0]!.y + points[1]!.y) / 2 } } : {}) };
    }
    const routed = root.paths.get(t.id)!;
    return {
      id: t.id,
      points: routed.points,
      ...(t.label !== undefined ? { label: t.label, labelPos: routed.labelPos! } : {}),
    };
  });

  // self-loop detours (and their labels) stick out past dagre's extent
  let w = Math.max(root.w, selfMaxRight);
  let h = root.h;
  for (const s of states) {
    w = Math.max(w, s.rect.x + s.rect.w);
    h = Math.max(h, s.rect.y + s.rect.h);
  }
  for (const n of notes) {
    w = Math.max(w, n.rect.x + n.rect.w);
    h = Math.max(h, n.rect.y + n.rect.h);
  }
  return { kind: "state", size: { w, h }, states, transitions, notes, regions: root.regions, regionSeparators: root.separators };
}
