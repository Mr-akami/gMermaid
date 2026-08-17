import type { EdgeId, NodeId } from "./ids";
import type {
  FlowchartArrowType,
  FlowchartDirection,
  FlowchartIR,
  FlowchartNode,
  FlowchartNodeShape,
} from "./flowchart";

// Actions carry user intent (ADR 0001) — not setters. Every update goes
// through applyFlowchartAction, which returns a new immutable IR.
// Identity contract: if the action changes nothing (unknown id, same value,
// invalid edge), the SAME ir reference is returned, so history and useMemo
// can rely on reference equality.
export type FlowchartAction =
  | { type: "addNode"; node: FlowchartNode }
  | { type: "removeNode"; id: NodeId }
  | { type: "updateNode"; id: NodeId; label?: string; shape?: FlowchartNodeShape }
  | { type: "addEdge"; id: EdgeId; from: NodeId; to: NodeId; arrow?: FlowchartArrowType }
  | { type: "removeEdge"; id: EdgeId }
  | { type: "updateEdge"; id: EdgeId; label?: string; arrow?: FlowchartArrowType }
  | { type: "setDirection"; direction: FlowchartDirection };

export function applyFlowchartAction(ir: FlowchartIR, action: FlowchartAction): FlowchartIR {
  switch (action.type) {
    case "addNode":
      if (ir.nodes.some((n) => n.id === action.node.id)) return ir;
      return { ...ir, nodes: [...ir.nodes, action.node] };
    case "removeNode": {
      if (!ir.nodes.some((n) => n.id === action.id)) return ir;
      return {
        ...ir,
        nodes: ir.nodes.filter((n) => n.id !== action.id),
        edges: ir.edges.filter((e) => e.from !== action.id && e.to !== action.id),
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
      // Endpoints must exist; self-loops are not supported (no layout for them).
      if (ir.edges.some((e) => e.id === action.id)) return ir;
      if (action.from === action.to) return ir;
      const known = (id: NodeId) => ir.nodes.some((n) => n.id === id);
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
  }
}
