import type { EdgeId, NodeId, SubgraphId } from "./ids";

export type FlowchartNodeShape =
  | "rect"
  | "rounded"
  | "stadium"
  | "diamond"
  | "circle"
  | "subroutine"
  | "cylinder"
  | "hexagon"
  | "asymmetric"
  | "doubleCircle"
  | "parallelogram"
  | "parallelogramAlt"
  | "trapezoid"
  | "trapezoidAlt";

export interface FlowchartNode {
  readonly id: NodeId;
  readonly label: string;
  readonly shape: FlowchartNodeShape;
  /** Subgraph membership; absent = top level. */
  readonly parent?: SubgraphId;
}

/** A `subgraph … end` block. Nesting via parent. */
export interface FlowchartSubgraph {
  readonly id: SubgraphId;
  readonly label: string;
  readonly parent?: SubgraphId;
  /** `direction X` inside the block. Preserved for the mermaid text; the
   * built-in layout engine cannot honor per-cluster direction and ignores it. */
  readonly direction?: FlowchartDirection;
}

export type FlowchartArrowType = "arrow" | "open" | "dotted" | "thick" | "invisible";

/** Edges may attach to a subgraph as a whole, not just to nodes. */
export type FlowchartEndpoint = NodeId | SubgraphId;

export interface FlowchartEdge {
  readonly id: EdgeId;
  readonly from: FlowchartEndpoint;
  readonly to: FlowchartEndpoint;
  readonly label?: string;
  readonly arrow: FlowchartArrowType;
}

export type FlowchartDirection = "TB" | "LR" | "BT" | "RL";

export interface FlowchartIR {
  readonly kind: "flowchart";
  readonly direction: FlowchartDirection;
  readonly nodes: readonly FlowchartNode[];
  readonly edges: readonly FlowchartEdge[];
  readonly subgraphs: readonly FlowchartSubgraph[];
}

export function emptyFlowchart(direction: FlowchartDirection = "TB"): FlowchartIR {
  return { kind: "flowchart", direction, nodes: [], edges: [], subgraphs: [] };
}
