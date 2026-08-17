import type { EdgeId, FlowchartArrowType, FlowchartNodeShape, NodeId } from "@gmermaid/ir";

// LayoutResult is pure data in diagram space. It carries ids only — never IR
// object references — so the renderer cannot reach into the IR. Must survive
// JSON.parse(JSON.stringify(x)) unchanged (guarded by test).
export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface NodeBox {
  readonly id: NodeId;
  readonly rect: Rect;
  readonly label: string;
  readonly shape: FlowchartNodeShape;
}

export interface EdgePath {
  readonly id: EdgeId;
  readonly points: readonly Point[];
  readonly label?: string;
  readonly labelPos?: Point;
  readonly arrow: FlowchartArrowType;
}

export interface FlowchartLayout {
  readonly kind: "flowchart";
  readonly size: { readonly w: number; readonly h: number };
  readonly nodes: readonly NodeBox[];
  readonly edges: readonly EdgePath[];
}
