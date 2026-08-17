import type { EdgeId, NodeId } from "./ids";

export type FlowchartNodeShape =
  | "rect"
  | "rounded"
  | "stadium"
  | "diamond"
  | "circle";

export interface FlowchartNode {
  readonly id: NodeId;
  readonly label: string;
  readonly shape: FlowchartNodeShape;
}

export type FlowchartArrowType = "arrow" | "open" | "dotted" | "thick";

export interface FlowchartEdge {
  readonly id: EdgeId;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly label?: string;
  readonly arrow: FlowchartArrowType;
}

export type FlowchartDirection = "TB" | "LR" | "BT" | "RL";

export interface FlowchartIR {
  readonly kind: "flowchart";
  readonly direction: FlowchartDirection;
  readonly nodes: readonly FlowchartNode[];
  readonly edges: readonly FlowchartEdge[];
}

export function emptyFlowchart(direction: FlowchartDirection = "TB"): FlowchartIR {
  return { kind: "flowchart", direction, nodes: [], edges: [] };
}
