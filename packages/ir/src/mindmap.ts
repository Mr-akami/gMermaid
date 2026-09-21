import type { MindmapNodeId } from "./ids";

// Mindmaps: a single rooted tree written as an indented outline. Mermaid has
// no edge syntax — hierarchy IS the indentation — so the IR keeps a flat node
// list where `parent` carries the tree and ARRAY ORDER carries sibling order.
// The root is the one node without a parent. `::icon(…)` and `:::class` lines
// are kept on the node so a round trip does not lose them; classes have no
// GUI meaning here (they are supplied by the embedding site) and the renderer
// ignores them, but mermaid's own docs use them heavily.

export const MINDMAP_SHAPES = ["default", "square", "rounded", "circle", "bang", "cloud", "hexagon"] as const;
export type MindmapShape = (typeof MINDMAP_SHAPES)[number];

export interface MindmapNode {
  /** Mermaid identifies mindmap nodes by this id in the text — exchange
   * identity. The default shape has no place for one, so those are minted
   * (`mindmap-N`) on import and dropped again by codegen. */
  readonly id: MindmapNodeId;
  readonly label: string;
  readonly shape: MindmapShape;
  /** Icon class string from `::icon(fa fa-book)`. */
  readonly icon?: string;
  /** Classes from a `:::a b` line — carried through, never rendered. */
  readonly classes?: readonly string[];
  /** Absent on the root, and only on the root. */
  readonly parent?: MindmapNodeId;
}

export interface MindmapIR {
  readonly kind: "mindmap";
  readonly nodes: readonly MindmapNode[];
}

export function emptyMindmap(): MindmapIR {
  return { kind: "mindmap", nodes: [] };
}

/** The single parentless node, or undefined for an empty mindmap. */
export function mindmapRoot(ir: MindmapIR): MindmapNode | undefined {
  return ir.nodes.find((n) => n.parent === undefined);
}

/** Direct children in sibling order (= array order). */
export function mindmapChildren(ir: MindmapIR, id: MindmapNodeId): readonly MindmapNode[] {
  return ir.nodes.filter((n) => n.parent === id);
}

/** `id` and everything below it. */
export function mindmapSubtree(ir: MindmapIR, id: MindmapNodeId): ReadonlySet<MindmapNodeId> {
  const doomed = new Set<MindmapNodeId>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of ir.nodes) {
      if (n.parent !== undefined && doomed.has(n.parent) && !doomed.has(n.id)) {
        doomed.add(n.id);
        grew = true;
      }
    }
  }
  return doomed;
}

/** Distance from the root (root = 0). */
export function mindmapDepth(ir: MindmapIR, id: MindmapNodeId): number {
  const byId = new Map(ir.nodes.map((n) => [n.id, n]));
  let d = 0;
  let cur = byId.get(id)?.parent;
  while (cur !== undefined && d <= ir.nodes.length) {
    d += 1;
    cur = byId.get(cur)?.parent;
  }
  return d;
}
