import type { EdgeId, NodeId, SubgraphId } from "./ids";
import type {
  FlowchartArrowType,
  FlowchartDirection,
  FlowchartEndpoint,
  FlowchartIR,
  FlowchartNode,
  FlowchartNodeShape,
  FlowchartSubgraph,
} from "./flowchart";
import { omitUndefined } from "./omitUndefined";

// Actions carry user intent (ADR 0001) — not setters. Every update goes
// through applyFlowchartAction, which returns a new immutable IR.
// Identity contract: if the action changes nothing (unknown id, same value,
// invalid edge), the SAME ir reference is returned, so history and useMemo
// can rely on reference equality.
export type FlowchartAction =
  | { type: "addNode"; node: FlowchartNode }
  | { type: "removeNode"; id: NodeId }
  | { type: "updateNode"; id: NodeId; label?: string; shape?: FlowchartNodeShape }
  | { type: "addEdge"; id: EdgeId; from: FlowchartEndpoint; to: FlowchartEndpoint; arrow?: FlowchartArrowType }
  | { type: "removeEdge"; id: EdgeId }
  | { type: "updateEdge"; id: EdgeId; label?: string; arrow?: FlowchartArrowType }
  | { type: "setDirection"; direction: FlowchartDirection }
  | { type: "addSubgraph"; subgraph: FlowchartSubgraph }
  | { type: "updateSubgraph"; id: SubgraphId; label?: string }
  // dissolve: members are promoted to the removed subgraph's parent
  | { type: "removeSubgraph"; id: SubgraphId };

export function applyFlowchartAction(ir: FlowchartIR, action: FlowchartAction): FlowchartIR {
  switch (action.type) {
    case "addNode": {
      const n = action.node;
      if (ir.nodes.some((x) => x.id === n.id) || ir.subgraphs.some((s) => (s.id as string) === (n.id as string))) return ir;
      if (n.parent !== undefined && !ir.subgraphs.some((s) => s.id === n.parent)) return ir;
      return { ...ir, nodes: [...ir.nodes, n] };
    }
    case "removeNode": {
      if (!ir.nodes.some((n) => n.id === action.id)) return ir;
      return {
        ...ir,
        nodes: ir.nodes.filter((n) => n.id !== action.id),
        edges: ir.edges.filter((e) => (e.from as string) !== (action.id as string) && (e.to as string) !== (action.id as string)),
      };
    }
    case "updateNode": {
      const node = ir.nodes.find((n) => n.id === action.id);
      if (!node) return ir;
      const label = action.label ?? node.label;
      const shape = action.shape ?? node.shape;
      if (label === node.label && shape === node.shape) return ir;
      return {
        ...ir,
        nodes: ir.nodes.map((n) => (n.id === action.id ? { ...n, label, shape } : n)),
      };
    }
    case "addEdge": {
      // Endpoints must exist (node or subgraph); self-loops are not
      // supported (no layout for them).
      if (ir.edges.some((e) => e.id === action.id)) return ir;
      if ((action.from as string) === (action.to as string)) return ir;
      const known = (id: FlowchartEndpoint) =>
        ir.nodes.some((n) => (n.id as string) === (id as string)) ||
        ir.subgraphs.some((s) => (s.id as string) === (id as string));
      if (!known(action.from) || !known(action.to)) return ir;
      return {
        ...ir,
        edges: [
          ...ir.edges,
          { id: action.id, from: action.from, to: action.to, arrow: action.arrow ?? "arrow" },
        ],
      };
    }
    case "removeEdge": {
      if (!ir.edges.some((e) => e.id === action.id)) return ir;
      return { ...ir, edges: ir.edges.filter((e) => e.id !== action.id) };
    }
    case "updateEdge": {
      const edge = ir.edges.find((e) => e.id === action.id);
      if (!edge) return ir;
      const raw = action.label ?? edge.label;
      const label = raw === "" ? undefined : raw; // clearing the label removes it
      const arrow = action.arrow ?? edge.arrow;
      if (label === edge.label && arrow === edge.arrow) return ir;
      return {
        ...ir,
        edges: ir.edges.map((e) =>
          e.id === action.id
            ? { id: e.id, from: e.from, to: e.to, arrow, ...(label !== undefined ? { label } : {}) }
            : e,
        ),
      };
    }
    case "setDirection":
      return ir.direction === action.direction ? ir : { ...ir, direction: action.direction };

    case "addSubgraph": {
      const s = action.subgraph;
      if (ir.subgraphs.some((x) => x.id === s.id) || ir.nodes.some((n) => (n.id as string) === (s.id as string))) return ir;
      if (s.parent !== undefined && !ir.subgraphs.some((x) => x.id === s.parent)) return ir;
      return { ...ir, subgraphs: [...ir.subgraphs, s] };
    }

    case "updateSubgraph": {
      const s = ir.subgraphs.find((x) => x.id === action.id);
      if (!s) return ir;
      const label = action.label ?? s.label;
      if (label === s.label) return ir;
      return { ...ir, subgraphs: ir.subgraphs.map((x) => (x.id === action.id ? { ...x, label } : x)) };
    }

    case "removeSubgraph": {
      const s = ir.subgraphs.find((x) => x.id === action.id);
      if (!s) return ir;
      const promote = s.parent;
      return {
        ...ir,
        subgraphs: ir.subgraphs
          .filter((x) => x.id !== action.id)
          .map((x) => (x.parent === action.id ? omitUndefined({ ...x, parent: promote }) : x)),
        nodes: ir.nodes.map((n) => (n.parent === action.id ? omitUndefined({ ...n, parent: promote }) : n)),
        edges: ir.edges.filter((e) => (e.from as string) !== (action.id as string) && (e.to as string) !== (action.id as string)),
      };
    }
  }
}
