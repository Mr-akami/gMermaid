import type { ArchEdgeId, ArchGroupId, ArchJunctionId, ArchServiceId, ArchSide, ArchitectureIR } from "@gmermaid/ir";
import { archGroupsParentFirst } from "@gmermaid/ir";
import type { TextMeasurer } from "./measurer";
import type { Point, Rect } from "./result";

// Architecture layout. Mermaid puts nodes on a GRID and lets the port sides of
// an edge (`a:R -- L:b`) decide the neighbour: b is one cell to the right of
// a. This does the same: every edge is a constraint between two cells, the
// grid is filled by walking those constraints, and then each column / row is
// as wide / tall as its widest / tallest occupant. A group is laid out as a
// grid of its own and enters its parent as one big cell, so an edge between
// two groups constrains the groups (the side vectors apply to whatever
// contains each end at that level). Sides are honoured wherever the grid has
// room for them; an edge that cannot be satisfied is still drawn, just not
// straight.

const LABEL_FONT = { fontSize: 13, fontFamily: "sans-serif" } as const;
const GROUP_FONT = { fontSize: 12, fontFamily: "sans-serif", bold: true } as const;
const EDGE_FONT = { fontSize: 11, fontFamily: "sans-serif" } as const;
export const ARCH_ICON = 64;
const LABEL_H = 22;
const MIN_NODE_W = 84;
const JUNCTION = 12;
const GAP_X = 72;
const GAP_Y = 60;
const GROUP_PAD_X = 22;
const GROUP_PAD_Y = 18;
const GROUP_TITLE_H = 30;
const EMPTY_GROUP = { w: 140, h: 90 };
/** Room outside the grid for stubs and elbows of edges that leave a border. */
const MARGIN = 36;
const STUB = 22;
/** Misalignment (px) between two ports that is straightened rather than bent. */
const SNAP = 12;
/** How far a same-row / same-column edge swings out to get round its own nodes. */
const DETOUR = 70;

export interface ArchServiceBox {
  readonly id: ArchServiceId;
  /** icon square + label underneath; the ports sit on this rectangle */
  readonly rect: Rect;
  readonly iconRect: Rect;
  readonly label: string;
  readonly icon?: string;
}

export interface ArchJunctionDot {
  readonly id: ArchJunctionId;
  readonly rect: Rect;
}

export interface ArchGroupFrame {
  readonly id: ArchGroupId;
  readonly rect: Rect;
  readonly label: string;
  readonly icon?: string;
}

export interface ArchEdgePath {
  readonly id: ArchEdgeId;
  readonly points: readonly Point[];
  readonly fromSide: ArchSide;
  readonly toSide: ArchSide;
  readonly arrowFrom: boolean;
  readonly arrowTo: boolean;
  readonly label?: string;
  readonly labelPos?: Point;
}

export interface ArchitectureLayout {
  readonly kind: "architecture";
  readonly size: { readonly w: number; readonly h: number };
  readonly groups: readonly ArchGroupFrame[];
  readonly services: readonly ArchServiceBox[];
  readonly junctions: readonly ArchJunctionDot[];
  readonly edges: readonly ArchEdgePath[];
}

/** Unit vector pointing OUT of the node through `side` (y grows downward). */
const OUT: Record<ArchSide, Point> = {
  T: { x: 0, y: -1 },
  B: { x: 0, y: 1 },
  L: { x: -1, y: 0 },
  R: { x: 1, y: 0 },
};

/** Where the target's cell lies relative to the source's: from the source it
 * is `side` away; and the target's own port faces back, so it is on the
 * opposite side — `R`→`L` is one cell right, `R`→`T` one right and one down. */
export function archCellOffset(fromSide: ArchSide, toSide: ArchSide): Point {
  const a = OUT[fromSide];
  const b = OUT[toSide];
  // `+ 0` keeps a negated zero from becoming -0
  return { x: (a.x !== 0 ? a.x : -b.x) + 0, y: (a.y !== 0 ? a.y : -b.y) + 0 };
}

interface Constraint {
  readonly a: string;
  readonly b: string;
  readonly dx: number;
  readonly dy: number;
  /** the nodes the edge really joins, inside items `a` and `b` */
  readonly na: string;
  readonly nb: string;
  /** width of the edge's label, which has to fit in the gap it runs across */
  readonly labelW: number;
}

interface Item {
  readonly key: string;
  readonly w: number;
  readonly h: number;
  /** where, inside the item, an edge joining it horizontally / vertically meets it */
  readonly ax: number;
  readonly ay: number;
}

interface Level {
  /** top-left of each item inside the level, origin (0,0) */
  readonly at: ReadonlyMap<string, Point>;
  readonly w: number;
  readonly h: number;
}

const cellKey = (x: number, y: number): string => `${x},${y}`;

/** Fill grid cells for `keys` so every constraint is met where possible. */
function assignCells(keys: readonly string[], constraints: readonly Constraint[]): Map<string, Point> {
  const adj = new Map<string, { to: string; dx: number; dy: number }[]>();
  for (const k of keys) adj.set(k, []);
  for (const c of constraints) {
    adj.get(c.a)?.push({ to: c.b, dx: c.dx, dy: c.dy });
    adj.get(c.b)?.push({ to: c.a, dx: -c.dx, dy: -c.dy });
  }

  const result = new Map<string, Point>();
  // unconnected pieces are packed into rows rather than one endless strip
  const wrapAt = Math.max(4, Math.ceil(Math.sqrt(keys.length * 1.5)));
  let cursorX = 0;
  let rowY = 0;
  let rowH = 0;

  for (const root of keys) {
    if (result.has(root)) continue;
    const local = new Map<string, Point>([[root, { x: 0, y: 0 }]]);
    const taken = new Set<string>([cellKey(0, 0)]);
    const queue = [root];
    while (queue.length > 0) {
      const u = queue.shift()!;
      const at = local.get(u)!;
      for (const { to, dx, dy } of adj.get(u) ?? []) {
        if (local.has(to) || result.has(to)) continue;
        let cell = { x: at.x + dx, y: at.y + dy };
        // blocked: carry on in the same direction, then fan out around it
        for (let k = 2; taken.has(cellKey(cell.x, cell.y)) && k <= 12; k++) cell = { x: at.x + dx * k, y: at.y + dy * k };
        for (let r = 1; taken.has(cellKey(cell.x, cell.y)); r++) {
          const base = { x: at.x + dx, y: at.y + dy };
          search: for (let oy = -r; oy <= r; oy++) {
            for (let ox = -r; ox <= r; ox++) {
              if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
              if (!taken.has(cellKey(base.x + ox, base.y + oy))) {
                cell = { x: base.x + ox, y: base.y + oy };
                break search;
              }
            }
          }
        }
        local.set(to, cell);
        taken.add(cellKey(cell.x, cell.y));
        queue.push(to);
      }
    }
    const xs = [...local.values()].map((p) => p.x);
    const ys = [...local.values()].map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const width = Math.max(...xs) - minX + 1;
    const height = Math.max(...ys) - minY + 1;
    if (cursorX > 0 && cursorX + width > wrapAt) {
      cursorX = 0;
      rowY += rowH;
      rowH = 0;
    }
    for (const [k, p] of local) result.set(k, { x: p.x - minX + cursorX, y: p.y - minY + rowY });
    cursorX += width;
    rowH = Math.max(rowH, height);
  }
  return result;
}

/** Place `items` on the grid `constraints` imply; tracks size to their content. */
function layoutLevel(items: readonly Item[], constraints: readonly Constraint[]): Level {
  if (items.length === 0) return { at: new Map(), w: 0, h: 0 };
  const cells = assignCells(items.map((i) => i.key), constraints);
  const cols = Math.max(...[...cells.values()].map((c) => c.x)) + 1;
  const rows = Math.max(...[...cells.values()].map((c) => c.y)) + 1;
  // items in one column line up on their anchors (the point a vertical edge
  // meets), items in one row on theirs — so a node inside a group and a node
  // outside it, joined by an edge, sit level and the edge is straight
  const colA = Array.from<number>({ length: cols }).fill(0);
  const rowA = Array.from<number>({ length: rows }).fill(0);
  for (const it of items) {
    const c = cells.get(it.key)!;
    colA[c.x] = Math.max(colA[c.x]!, it.ax);
    rowA[c.y] = Math.max(rowA[c.y]!, it.ay);
  }
  const colW = Array.from<number>({ length: cols }).fill(0);
  const rowH = Array.from<number>({ length: rows }).fill(0);
  for (const it of items) {
    const c = cells.get(it.key)!;
    colW[c.x] = Math.max(colW[c.x]!, colA[c.x]! - it.ax + it.w);
    rowH[c.y] = Math.max(rowH[c.y]!, rowA[c.y]! - it.ay + it.h);
  }
  // a label on a horizontal run sits in the gap between two neighbouring
  // columns, so that gap grows to hold it
  const gapAfter = Array.from<number>({ length: cols }).fill(GAP_X);
  for (const c of constraints) {
    const a = cells.get(c.a);
    const b = cells.get(c.b);
    if (!a || !b || c.labelW === 0 || a.y !== b.y || Math.abs(a.x - b.x) !== 1) continue;
    const i = Math.min(a.x, b.x);
    gapAfter[i] = Math.max(gapAfter[i]!, c.labelW + 28);
  }
  const colX: number[] = [];
  const rowY: number[] = [];
  let x = 0;
  for (let i = 0; i < cols; i++) {
    colX.push(x);
    x += colW[i]! + gapAfter[i]!;
  }
  let y = 0;
  for (let i = 0; i < rows; i++) {
    rowY.push(y);
    y += rowH[i]! + GAP_Y;
  }
  const at = new Map<string, Point>();
  for (const it of items) {
    const c = cells.get(it.key)!;
    at.set(it.key, { x: colX[c.x]! + colA[c.x]! - it.ax, y: rowY[c.y]! + rowA[c.y]! - it.ay });
  }
  return { at, w: x - gapAfter[cols - 1]!, h: y - GAP_Y };
}

const portPoint = (r: Rect, side: ArchSide): Point => {
  switch (side) {
    case "T":
      return { x: r.x + r.w / 2, y: r.y };
    case "B":
      return { x: r.x + r.w / 2, y: r.y + r.h };
    case "L":
      return { x: r.x, y: r.y + r.h / 2 };
    case "R":
      return { x: r.x + r.w, y: r.y + r.h / 2 };
  }
};

const horizontal = (s: ArchSide): boolean => s === "L" || s === "R";

/** Orthogonal route from a port to a port, leaving each end along its side. */
export function archRoute(p0: Point, s0: ArchSide, p3: Point, s3: ArchSide): Point[] {
  const d0 = OUT[s0];
  const d3 = OUT[s3];
  const a = { x: p0.x + d0.x * STUB, y: p0.y + d0.y * STUB };
  const b = { x: p3.x + d3.x * STUB, y: p3.y + d3.y * STUB };
  let pts: Point[];
  if (horizontal(s0) && horizontal(s3)) {
    const facing = d0.x * (p3.x - p0.x) >= 2 * STUB && d3.x * (p0.x - p3.x) >= 2 * STUB;
    if (facing) {
      const mx = (p0.x + p3.x) / 2;
      pts = [p0, { x: mx, y: p0.y }, { x: mx, y: p3.y }, p3];
    } else {
      if (p0.y === p3.y) {
        // one row, ports not facing: a straight line would run through the nodes, so go round below
        const my = p0.y + DETOUR;
        pts = [p0, a, { x: a.x, y: my }, { x: b.x, y: my }, b, p3];
      } else {
        // go round: out of both ports, then across at whichever stub reaches furthest
        const mx = d0.x > 0 || d3.x > 0 ? Math.max(a.x, b.x) : Math.min(a.x, b.x);
        pts = [p0, { x: mx, y: p0.y }, { x: mx, y: p3.y }, p3];
      }
    }
  } else if (!horizontal(s0) && !horizontal(s3)) {
    const facing = d0.y * (p3.y - p0.y) >= 2 * STUB && d3.y * (p0.y - p3.y) >= 2 * STUB;
    if (facing) {
      const my = (p0.y + p3.y) / 2;
      pts = [p0, { x: p0.x, y: my }, { x: p3.x, y: my }, p3];
    } else {
      if (p0.x === p3.x) {
        const mx = p0.x + DETOUR;
        pts = [p0, a, { x: mx, y: a.y }, { x: mx, y: b.y }, b, p3];
      } else {
        const my = d0.y > 0 || d3.y > 0 ? Math.max(a.y, b.y) : Math.min(a.y, b.y);
        pts = [p0, { x: p0.x, y: my }, { x: p3.x, y: my }, p3];
      }
    }
  } else {
    // one horizontal, one vertical: a single elbow when both ends can take it
    const h = horizontal(s0) ? { p: p0, d: d0 } : { p: p3, d: d3 };
    const v = horizontal(s0) ? { p: p3, d: d3 } : { p: p0, d: d0 };
    const corner = { x: v.p.x, y: h.p.y };
    const hOk = h.d.x * (corner.x - h.p.x) > 0;
    const vOk = v.d.y * (corner.y - v.p.y) > 0;
    if (hOk && vOk) pts = [p0, corner, p3];
    else if (horizontal(s0)) pts = [p0, a, { x: a.x, y: b.y }, b, p3];
    else pts = [p0, a, { x: b.x, y: a.y }, b, p3];
  }
  // drop repeats and points in the middle of a straight run
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    out.push(p);
  }
  return out.filter((p, i) => {
    const prev = out[i - 1];
    const next = out[i + 1];
    if (!prev || !next) return true;
    return !((prev.x === p.x && p.x === next.x) || (prev.y === p.y && p.y === next.y));
  });
}

function labelAt(points: readonly Point[]): Point {
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i + 1 < points.length; i++) {
    const len = Math.abs(points[i + 1]!.x - points[i]!.x) + Math.abs(points[i + 1]!.y - points[i]!.y);
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  const a = points[best]!;
  const b = points[best + 1] ?? a;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 5 };
}

/** Label spot of an edge. A straight horizontal run starts and ends on icons,
 * but the nodes' boxes are wider (captions), so the middle of the run is not
 * the middle of the clear space — centre the label between the BOXES instead. */
function labelBetween(points: readonly Point[], from: Rect, to: Rect): Point {
  const at = labelAt(points);
  if (points.length !== 2 || points[0]!.y !== points[1]!.y) return at;
  const xs = [from.x, from.x + from.w, to.x, to.x + to.w].toSorted((a, b) => a - b);
  const gapStart = xs[1]!;
  const gapEnd = xs[2]!;
  const clear = from.x + from.w <= to.x || to.x + to.w <= from.x;
  return clear && gapEnd > gapStart ? { x: (gapStart + gapEnd) / 2, y: at.y } : at;
}

const textOf = (x: { name: string; label?: string }): string => x.label ?? x.name;

export function layoutArchitecture(ir: ArchitectureIR, measure: TextMeasurer): ArchitectureLayout {
  const groupOf = new Map<string, ArchGroupId | undefined>();
  for (const g of ir.groups) groupOf.set(g.id, g.parent);
  for (const s of ir.services) groupOf.set(s.id, s.group);
  for (const j of ir.junctions) groupOf.set(j.id, j.group);
  const isGroup = new Set<string>(ir.groups.map((g) => g.id));

  // a cycle (only reachable by hand-built IR) must not hang the walk below
  const parentOf = (id: string): string | undefined => {
    const p = groupOf.get(id);
    return p !== undefined && p !== id && isGroup.has(p) ? p : undefined;
  };

  const serviceIds = new Set<string>(ir.services.map((s) => s.id));
  const nodeSize = new Map<string, { w: number; h: number }>();
  for (const s of ir.services) {
    const label = textOf(s);
    nodeSize.set(s.id, { w: Math.max(MIN_NODE_W, measure.measure(label, LABEL_FONT).w + 16), h: ARCH_ICON + LABEL_H });
  }
  for (const j of ir.junctions) nodeSize.set(j.id, { w: JUNCTION, h: JUNCTION });

  const childrenOf = (container: string | undefined): string[] => [
    ...ir.groups.filter((g) => parentOf(g.id) === container).map((g) => g.id as string),
    ...ir.services.filter((s) => parentOf(s.id) === container).map((s) => s.id as string),
    ...ir.junctions.filter((j) => parentOf(j.id) === container).map((j) => j.id as string),
  ];

  /** The child of `container` that holds `id` (or is it), if any. */
  const itemAt = (id: string, container: string | undefined): string | undefined => {
    let cur: string | undefined = id;
    const seen = new Set<string>();
    while (cur !== undefined && !seen.has(cur)) {
      if (parentOf(cur) === container) return cur;
      seen.add(cur);
      cur = parentOf(cur);
    }
    return undefined;
  };

  const levels = new Map<string | undefined, Level>();
  const groupSize = new Map<string, { w: number; h: number; offsetX: number }>();

  /** Centre of node `id` relative to the top-left of `item` (the node itself,
   * or a group that holds it at any depth). */
  const nodeAnchor = (item: string, id: string): Point => {
    const inner = levels.get(item);
    const gs = groupSize.get(item);
    const child = inner && gs ? itemAt(id, item) : undefined;
    if (!inner || !gs || child === undefined) {
      const s = isGroup.has(item) ? gs : nodeSize.get(item);
      // a service's edges meet its icon, not the caption hung below it
      const y = !isGroup.has(item) && serviceIds.has(item) ? ARCH_ICON / 2 : (s?.h ?? JUNCTION) / 2;
      return { x: (s?.w ?? JUNCTION) / 2, y };
    }
    const pos = inner.at.get(child)!;
    const a = nodeAnchor(child, id);
    return { x: gs.offsetX + pos.x + a.x, y: GROUP_TITLE_H + pos.y + a.y };
  };

  const build = (container: string | undefined, trail: ReadonlySet<string>): Level => {
    const cached = levels.get(container);
    if (cached) return cached;
    const sized = childrenOf(container).map((key) => {
      if (isGroup.has(key) && !trail.has(key)) {
        const inner = build(key, new Set([...trail, key]));
        const g = ir.groups.find((x) => x.id === key)!;
        const label = g.label ?? "";
        const titleW = label === "" ? 0 : measure.measure(label, GROUP_FONT).w + (g.icon !== undefined ? 26 : 0) + 24;
        const empty = inner.w === 0;
        const w = Math.max(empty ? EMPTY_GROUP.w : inner.w + GROUP_PAD_X * 2, titleW + GROUP_PAD_X);
        const h = empty ? EMPTY_GROUP.h : inner.h + GROUP_TITLE_H + GROUP_PAD_Y;
        groupSize.set(key, { w, h, offsetX: (w - inner.w) / 2 });
        return { key, w, h };
      }
      const s = nodeSize.get(key) ?? { w: JUNCTION, h: JUNCTION };
      return { key, w: s.w, h: s.h };
    });
    const constraints: Constraint[] = [];
    for (const e of ir.edges) {
      const a = itemAt(e.from, container);
      const b = itemAt(e.to, container);
      if (a === undefined || b === undefined || a === b) continue;
      const d = archCellOffset(e.fromSide, e.toSide);
      constraints.push({ a, b, dx: d.x, dy: d.y, na: e.from, nb: e.to, labelW: e.label !== undefined ? measure.measure(e.label, EDGE_FONT).w : 0 });
    }
    const items: Item[] = sized.map(({ key, w, h }) => {
      // the first edge that meets this item along an axis names its anchor
      const along = (axis: "x" | "y"): number => {
        const c = constraints.find((k) => (k.a === key || k.b === key) && (axis === "y" ? k.dy === 0 : k.dx === 0));
        if (c === undefined) return nodeAnchor(key, key)[axis];
        return nodeAnchor(key, c.a === key ? c.na : c.nb)[axis];
      };
      return { key, w, h, ax: along("x"), ay: along("y") };
    });
    const level = layoutLevel(items, constraints);
    levels.set(container, level);
    return level;
  };

  const top = build(undefined, new Set());

  // absolute positions, parents before children
  const groups: ArchGroupFrame[] = [];
  const rects = new Map<string, Rect>();
  const place = (container: string | undefined, ox: number, oy: number): void => {
    const level = levels.get(container);
    if (!level) return;
    for (const [key, at] of level.at) {
      const x = ox + at.x;
      const y = oy + at.y;
      const g = groupSize.get(key);
      if (g && isGroup.has(key)) {
        rects.set(key, { x, y, w: g.w, h: g.h });
        place(key, x + g.offsetX, y + GROUP_TITLE_H);
      } else {
        const s = nodeSize.get(key) ?? { w: JUNCTION, h: JUNCTION };
        rects.set(key, { x, y, w: s.w, h: s.h });
      }
    }
  };
  place(undefined, MARGIN, MARGIN);

  for (const g of archGroupsParentFirst(ir)) {
    const rect = rects.get(g.id);
    if (rect) groups.push({ id: g.id, rect, label: g.label ?? "", ...(g.icon !== undefined ? { icon: g.icon } : {}) });
  }

  const services: ArchServiceBox[] = ir.services.flatMap((s) => {
    const rect = rects.get(s.id);
    if (!rect) return [];
    return [
      {
        id: s.id,
        rect,
        iconRect: { x: rect.x + (rect.w - ARCH_ICON) / 2, y: rect.y, w: ARCH_ICON, h: ARCH_ICON },
        label: s.label ?? s.name,
        ...(s.icon !== undefined ? { icon: s.icon } : {}),
      },
    ];
  });
  const junctions: ArchJunctionDot[] = ir.junctions.flatMap((j) => {
    const rect = rects.get(j.id);
    return rect ? [{ id: j.id, rect }] : [];
  });

  const iconRects = new Map<string, Rect>(services.map((s) => [s.id as string, s.iconRect]));
  const edges: ArchEdgePath[] = ir.edges.flatMap((e) => {
    const fromRect = rects.get(e.from);
    const toRect = rects.get(e.to);
    if (!fromRect || !toRect) return [];
    // `{group}`: the edge ends on the border of the node's group, level with the node
    const end = (id: string, rect: Rect, side: ArchSide, onGroup: boolean): Point => {
      const gid = onGroup ? parentOf(id) : undefined;
      const gr = gid !== undefined ? rects.get(gid) : undefined;
      // left, right and top ports sit on the icon; the bottom one below the caption
      const icon = side !== "B" ? iconRects.get(id) : undefined;
      const p = portPoint(icon ?? rect, side);
      if (!gr) return p;
      return horizontal(side) ? { x: portPoint(gr, side).x, y: p.y } : { x: p.x, y: portPoint(gr, side).y };
    };
    const p0 = end(e.from, fromRect, e.fromSide, e.groupFrom === true);
    let p3 = end(e.to, toRect, e.toSide, e.groupTo === true);
    // nodes at different nesting depths centre a few px apart; where the far
    // end can take it, meet the near end level instead of drawing a jog
    if (horizontal(e.fromSide) && horizontal(e.toSide) && Math.abs(p0.y - p3.y) <= SNAP && p0.y >= toRect.y && p0.y <= toRect.y + toRect.h) {
      p3 = { x: p3.x, y: p0.y };
    } else if (!horizontal(e.fromSide) && !horizontal(e.toSide) && Math.abs(p0.x - p3.x) <= SNAP && p0.x >= toRect.x && p0.x <= toRect.x + toRect.w) {
      p3 = { x: p0.x, y: p3.y };
    }
    const points = archRoute(p0, e.fromSide, p3, e.toSide);
    return [
      {
        id: e.id,
        points,
        fromSide: e.fromSide,
        toSide: e.toSide,
        arrowFrom: e.arrowFrom,
        arrowTo: e.arrowTo,
        ...(e.label !== undefined ? { label: e.label, labelPos: labelBetween(points, fromRect, toRect) } : {}),
      },
    ];
  });

  // the canvas covers everything drawn, edge detours and labels included
  let maxX = top.w + MARGIN * 2;
  let maxY = top.h + MARGIN * 2;
  for (const e of edges) {
    for (const p of e.points) {
      maxX = Math.max(maxX, p.x + MARGIN / 2);
      maxY = Math.max(maxY, p.y + MARGIN / 2);
    }
    if (e.label !== undefined && e.labelPos) {
      maxX = Math.max(maxX, e.labelPos.x + measure.measure(e.label, EDGE_FONT).w / 2 + 8);
    }
  }

  return { kind: "architecture", size: { w: maxX, h: maxY }, groups, services, junctions, edges };
}
