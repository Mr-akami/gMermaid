import { mindmapChildren, mindmapRoot, type MindmapIR, type MindmapNode, type MindmapNodeId, type MindmapShape } from "@gmermaid/ir";
import type { TextMeasurer, TextStyle } from "./measurer";
import type { Point, Rect } from "./result";

// Mindmaps are trees, so this layout is arithmetic only — no dagre. It is a
// balanced left/right tree in mermaid's spirit: the root sits in the middle
// and its children alternate right, left, right, … Each side is a horizontal
// Reingold–Tilford-lite tree: subtree heights are computed bottom-up, the
// children of a node are stacked vertically inside that height, and the node
// is centred on its own subtree band. Branches are cubic beziers (4 control
// points) so the renderer stays a dumb path writer.

const LABEL_STYLE: TextStyle = { fontSize: 14, fontFamily: "sans-serif" };
const ROOT_STYLE: TextStyle = { fontSize: 16, fontFamily: "sans-serif", bold: true };

/** Horizontal gap between a node and its children. */
const H_GAP = 56;
/** Vertical gap between sibling subtrees. */
const V_GAP = 14;
const MIN_W = 40;

/** Padding per shape: the fat shapes need room for their outline. */
const PADDING: Record<MindmapShape, { x: number; y: number }> = {
  default: { x: 8, y: 6 },
  square: { x: 16, y: 10 },
  rounded: { x: 18, y: 10 },
  hexagon: { x: 24, y: 10 },
  circle: { x: 26, y: 20 },
  bang: { x: 26, y: 18 },
  cloud: { x: 28, y: 18 },
};

/** Which half a node lives in; the root itself is the pivot. */
export type MindmapSide = "root" | "left" | "right";

export interface MindmapNodeBox {
  readonly id: MindmapNodeId;
  readonly label: string;
  readonly shape: MindmapShape;
  readonly rect: Rect;
  /** Distance from the root — the renderer turns it into a fill colour. */
  readonly depth: number;
  readonly side: MindmapSide;
  readonly icon?: string;
}

export interface MindmapBranch {
  /** The child's id: a tree has exactly one branch per non-root node. */
  readonly id: MindmapNodeId;
  readonly from: MindmapNodeId;
  readonly to: MindmapNodeId;
  /** Cubic bezier control points: start, c1, c2, end. */
  readonly points: readonly Point[];
}

export interface MindmapLayout {
  readonly kind: "mindmap";
  readonly size: { readonly w: number; readonly h: number };
  readonly nodes: readonly MindmapNodeBox[];
  readonly branches: readonly MindmapBranch[];
}

/** Imported `<br/>` is a newline: measure the widest row, stack the rest. */
function measureBlock(measure: TextMeasurer, text: string, style: TextStyle): { w: number; h: number } {
  const rows = text.split("\n");
  let w = 0;
  for (const row of rows) w = Math.max(w, measure.measure(row, style).w);
  return { w, h: measure.measure("x", style).h * rows.length };
}

export function layoutMindmap(ir: MindmapIR, measure: TextMeasurer): MindmapLayout {
  const root = mindmapRoot(ir);
  if (!root) return { kind: "mindmap", size: { w: 200, h: 100 }, nodes: [], branches: [] };

  const size = new Map<MindmapNodeId, { w: number; h: number }>();
  for (const n of ir.nodes) {
    const pad = PADDING[n.shape];
    const m = measureBlock(measure, n.label, n.id === root.id ? ROOT_STYLE : LABEL_STYLE);
    size.set(n.id, { w: Math.max(MIN_W, m.w + pad.x * 2), h: m.h + pad.y * 2 });
  }

  // bottom-up: how tall a whole subtree is, gaps included
  const subtreeH = new Map<MindmapNodeId, number>();
  const heightOf = (n: MindmapNode): number => {
    const cached = subtreeH.get(n.id);
    if (cached !== undefined) return cached;
    const children = mindmapChildren(ir, n.id);
    const own = size.get(n.id)!.h;
    let total = 0;
    for (const c of children) total += heightOf(c);
    if (children.length > 0) total += V_GAP * (children.length - 1);
    const h = Math.max(own, total);
    subtreeH.set(n.id, h);
    return h;
  };

  const boxes = new Map<MindmapNodeId, MindmapNodeBox>();

  /** Place `node` (left edge `x`, subtree band starting at `top`) and its
   * descendants. Children are stacked inside the band; the node is then
   * centred between the first and last of them (Reingold–Tilford), clamped
   * to its own band so sibling bands can never overlap. */
  const place = (node: MindmapNode, x: number, top: number, side: MindmapSide, depth: number): void => {
    const own = size.get(node.id)!;
    const band = heightOf(node);
    const children = mindmapChildren(ir, node.id);

    let y = top + (band - own.h) / 2;
    if (children.length > 0) {
      let stack = 0;
      for (const c of children) stack += heightOf(c);
      stack += V_GAP * (children.length - 1);
      let cursor = top + (band - stack) / 2;
      const centers: number[] = [];
      for (const c of children) {
        const childW = size.get(c.id)!.w;
        const childX = side === "left" ? x - H_GAP - childW : x + own.w + H_GAP;
        place(c, childX, cursor, side, depth + 1);
        const placed = boxes.get(c.id)!.rect;
        centers.push(placed.y + placed.h / 2);
        cursor += heightOf(c) + V_GAP;
      }
      const mid = (centers[0]! + centers[centers.length - 1]!) / 2;
      y = Math.min(Math.max(mid - own.h / 2, top), top + band - own.h);
    }

    boxes.set(node.id, {
      id: node.id,
      label: node.label,
      shape: node.shape,
      rect: { x, y, w: own.w, h: own.h },
      depth,
      side,
      ...(node.icon !== undefined ? { icon: node.icon } : {}),
    });
  };

  // the root's children alternate right, left, right, … (mermaid's balance)
  const rootChildren = mindmapChildren(ir, root.id);
  const right = rootChildren.filter((_, i) => i % 2 === 0);
  const left = rootChildren.filter((_, i) => i % 2 === 1);
  const sideHeight = (xs: readonly MindmapNode[]): number =>
    xs.length === 0 ? 0 : xs.reduce((acc, n) => acc + heightOf(n), 0) + V_GAP * (xs.length - 1);
  const rootSize = size.get(root.id)!;
  const centerY = Math.max(sideHeight(right), sideHeight(left), rootSize.h) / 2;

  boxes.set(root.id, {
    id: root.id,
    label: root.label,
    shape: root.shape,
    rect: { x: 0, y: centerY - rootSize.h / 2, w: rootSize.w, h: rootSize.h },
    depth: 0,
    side: "root",
    ...(root.icon !== undefined ? { icon: root.icon } : {}),
  });

  for (const [nodes, side] of [
    [right, "right"],
    [left, "left"],
  ] as const) {
    let cursor = centerY - sideHeight(nodes) / 2;
    for (const n of nodes) {
      const w = size.get(n.id)!.w;
      const x = side === "left" ? 0 - H_GAP - w : rootSize.w + H_GAP;
      place(n, x, cursor, side, 1);
      cursor += heightOf(n) + V_GAP;
    }
  }

  // shift everything into positive coordinates (the left half runs negative)
  let minX = 0;
  let minY = 0;
  for (const b of boxes.values()) {
    minX = Math.min(minX, b.rect.x);
    minY = Math.min(minY, b.rect.y);
  }
  const nodes: MindmapNodeBox[] = ir.nodes
    .map((n) => boxes.get(n.id))
    .filter((b): b is MindmapNodeBox => b !== undefined)
    .map((b) => ({ ...b, rect: { ...b.rect, x: b.rect.x - minX, y: b.rect.y - minY } }));

  const rectOf = new Map(nodes.map((b) => [b.id, b]));
  const branches: MindmapBranch[] = [];
  for (const n of ir.nodes) {
    if (n.parent === undefined) continue;
    const child = rectOf.get(n.id);
    const parent = rectOf.get(n.parent);
    if (!child || !parent) continue;
    // a root child leaves the root on the side it was placed on
    const side = child.side === "left" ? "left" : "right";
    const start: Point =
      side === "left"
        ? { x: parent.rect.x, y: parent.rect.y + parent.rect.h / 2 }
        : { x: parent.rect.x + parent.rect.w, y: parent.rect.y + parent.rect.h / 2 };
    const end: Point =
      side === "left"
        ? { x: child.rect.x + child.rect.w, y: child.rect.y + child.rect.h / 2 }
        : { x: child.rect.x, y: child.rect.y + child.rect.h / 2 };
    const mid = (start.x + end.x) / 2;
    branches.push({
      id: n.id,
      from: n.parent,
      to: n.id,
      points: [start, { x: mid, y: start.y }, { x: mid, y: end.y }, end],
    });
  }

  let w = 0;
  let h = 0;
  for (const b of nodes) {
    w = Math.max(w, b.rect.x + b.rect.w);
    h = Math.max(h, b.rect.y + b.rect.h);
  }
  return { kind: "mindmap", size: { w, h }, nodes, branches };
}
