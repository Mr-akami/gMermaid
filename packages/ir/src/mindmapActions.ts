import type { MindmapNodeId } from "./ids";
import { mindmapSubtree, type MindmapIR, type MindmapNode, type MindmapShape } from "./mindmap";
import { omitUndefined } from "./omitUndefined";

// Same contract as the other diagram actions: intent-carrying, immutable,
// identity-preserving on no-ops.

export type MindmapAction =
  /** `after` = the sibling to insert behind; otherwise last among siblings. */
  | { type: "addNode"; node: MindmapNode; after?: MindmapNodeId }
  /** Removes the node AND its whole subtree (a mindmap has no orphans). */
  | { type: "removeNode"; id: MindmapNodeId }
  | { type: "updateNode"; id: MindmapNodeId; label?: string; shape?: MindmapShape; icon?: string; classes?: readonly string[] }
  /** Re-parent (drag onto another node). The root can never move. */
  | { type: "moveNode"; id: MindmapNodeId; parent: MindmapNodeId }
  /** Swap with the neighbouring sibling; out of range = no-op. */
  | { type: "reorderNode"; id: MindmapNodeId; delta: -1 | 1 };

const norm = (v: string | undefined) => (v === undefined || v === "" ? undefined : v);

/** Why `id` cannot become a child of `parent`, or undefined when it can.
 * Shared by the reducer (reject) and the UI (show the reason — a silent
 * no-op would read as "the drag did nothing"). */
export function mindmapMoveRejection(ir: MindmapIR, id: MindmapNodeId, parent: MindmapNodeId): string | undefined {
  const node = ir.nodes.find((n) => n.id === id);
  if (!node) return "unknown node";
  if (node.parent === undefined) return "the root cannot be moved";
  if (!ir.nodes.some((n) => n.id === parent)) return "unknown target node";
  if (parent === id) return "cannot move a node into itself";
  if (mindmapSubtree(ir, id).has(parent)) return "cannot move a node into its own subtree";
  return undefined;
}

/** Insert `node` into the flat list so it lands last among its siblings, or
 * directly behind `after`. Sibling order is array order, so only the
 * relative position of same-parent nodes matters. */
function insert(nodes: readonly MindmapNode[], node: MindmapNode, after: MindmapNodeId | undefined): MindmapNode[] {
  if (after === undefined) return [...nodes, node];
  const at = nodes.findIndex((n) => n.id === after);
  if (at < 0) return [...nodes, node];
  return [...nodes.slice(0, at + 1), node, ...nodes.slice(at + 1)];
}

export function applyMindmapAction(ir: MindmapIR, action: MindmapAction): MindmapIR {
  switch (action.type) {
    case "addNode": {
      const n = action.node;
      if (ir.nodes.some((x) => x.id === n.id)) return ir;
      if (n.parent === undefined) {
        // exactly one root: a second parentless node has no mermaid form
        if (ir.nodes.length > 0) return ir;
      } else if (!ir.nodes.some((x) => x.id === n.parent)) {
        return ir;
      }
      const after = action.after !== undefined && ir.nodes.find((x) => x.id === action.after)?.parent === n.parent
        ? action.after
        : undefined;
      return { ...ir, nodes: insert(ir.nodes, omitUndefined({ ...n, icon: norm(n.icon) }), after) };
    }

    case "removeNode": {
      if (!ir.nodes.some((n) => n.id === action.id)) return ir;
      const doomed = mindmapSubtree(ir, action.id);
      return { ...ir, nodes: ir.nodes.filter((n) => !doomed.has(n.id)) };
    }

    case "updateNode": {
      const n = ir.nodes.find((x) => x.id === action.id);
      if (!n) return ir;
      const label = action.label ?? n.label;
      const shape = action.shape ?? n.shape;
      const icon = action.icon !== undefined ? norm(action.icon) : n.icon;
      const classes = action.classes !== undefined ? (action.classes.length > 0 ? action.classes : undefined) : n.classes;
      if (label === n.label && shape === n.shape && icon === n.icon && classes === n.classes) return ir;
      return {
        ...ir,
        nodes: ir.nodes.map((x) => (x.id === action.id ? omitUndefined({ ...x, label, shape, icon, classes }) : x)),
      };
    }

    case "moveNode": {
      if (mindmapMoveRejection(ir, action.id, action.parent) !== undefined) return ir;
      const n = ir.nodes.find((x) => x.id === action.id)!;
      if (n.parent === action.parent) return ir;
      // move to the end of the new parent's children, keeping the subtree
      const moved = { ...n, parent: action.parent };
      return { ...ir, nodes: [...ir.nodes.filter((x) => x.id !== action.id), moved] };
    }

    case "reorderNode": {
      const n = ir.nodes.find((x) => x.id === action.id);
      if (!n || n.parent === undefined) return ir;
      const siblings = ir.nodes.filter((x) => x.parent === n.parent);
      const at = siblings.findIndex((x) => x.id === action.id);
      const other = siblings[at + action.delta];
      if (!other) return ir;
      // swap the two nodes' slots in the flat list; the rest is untouched
      const i = ir.nodes.findIndex((x) => x.id === n.id);
      const j = ir.nodes.findIndex((x) => x.id === other.id);
      const nodes = [...ir.nodes];
      [nodes[i], nodes[j]] = [nodes[j]!, nodes[i]!];
      return { ...ir, nodes };
    }
  }
}
