import type { EdgeId, NodeId, SubgraphId } from "./ids";
import type {
  FlowchartDirection,
  FlowchartEdgeHead,
  FlowchartEndpoint,
  FlowchartIR,
  FlowchartLineStyle,
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
  | { type: "addEdge"; id: EdgeId; from: FlowchartEndpoint; to: FlowchartEndpoint; line?: FlowchartLineStyle; headEnd?: FlowchartEdgeHead }
  | { type: "removeEdge"; id: EdgeId }
  // length: 1 (the default) is stored as absent
  | {
      type: "updateEdge";
      id: EdgeId;
      label?: string;
      line?: FlowchartLineStyle;
      headStart?: FlowchartEdgeHead;
      headEnd?: FlowchartEdgeHead;
      length?: number;
    }
  | { type: "setDirection"; direction: FlowchartDirection }
  | { type: "addSubgraph"; subgraph: FlowchartSubgraph }
  // direction null = remove the per-subgraph override
  | { type: "updateSubgraph"; id: SubgraphId; label?: string; direction?: FlowchartDirection | null }
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
          {
            id: action.id,
            from: action.from,
            to: action.to,
            line: action.line ?? "solid",
            headStart: "none",
            headEnd: action.headEnd ?? "arrow",
          },
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
      const line = action.line ?? edge.line;
      const headStart = action.headStart ?? edge.headStart;
      const headEnd = action.headEnd ?? edge.headEnd;
      const rawLen = action.length ?? edge.length ?? 1;
      const length = Number.isInteger(rawLen) && rawLen > 1 ? rawLen : undefined;
      if (label === edge.label && line === edge.line && headStart === edge.headStart && headEnd === edge.headEnd && length === edge.length) return ir;
      return {
        ...ir,
        edges: ir.edges.map((e) =>
          e.id === action.id ? omitUndefined({ id: e.id, from: e.from, to: e.to, line, headStart, headEnd, label, length }) : e,
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
      const direction = action.direction === null ? undefined : (action.direction ?? s.direction);
      if (label === s.label && direction === s.direction) return ir;
      return { ...ir, subgraphs: ir.subgraphs.map((x) => (x.id === action.id ? omitUndefined({ ...x, label, direction }) : x)) };
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
