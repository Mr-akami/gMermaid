import type { EdgeId, NodeId, SubgraphId } from "./ids";

// Bracket-form shapes (`A["x"]`, `A(("x"))`, …) plus the `A@{ shape: … }`
// only shapes of mermaid 11. Names are ours; FLOWCHART_SHAPES maps them to
// mermaid's canonical `@{ shape }` name and aliases.
export type FlowchartNodeShape =
  // bracket forms
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
  | "trapezoidAlt"
  // `@{ shape }` only
  | "text"
  | "doc"
  | "notchRect"
  | "hourglass"
  | "delay"
  | "fork"
  | "bolt"
  | "tri"
  | "flipTri"
  | "slRect"
  | "linCyl"
  | "fCirc"
  | "brace"
  | "crossCirc"
  | "linRect"
  | "winPane"
  | "stRect"
  | "docs"
  | "bowRect"
  | "divRect"
  | "curvTrap"
  | "tagRect"
  | "smCirc";

export interface FlowchartShapeInfo {
  readonly shape: FlowchartNodeShape;
  /** Canonical mermaid `@{ shape: … }` name (what codegen emits). */
  readonly mermaid: string;
  /** Every name mermaid accepts for this shape, canonical first. */
  readonly aliases: readonly string[];
  /** Human name for the property window. */
  readonly label: string;
  /** Property-window grouping. */
  readonly group: "Basic" | "Process" | "Data" | "Flow" | "Misc";
  /** True for shapes that draw no text (mermaid hides the label too). */
  readonly noLabel?: true;
}

export const FLOWCHART_SHAPES: readonly FlowchartShapeInfo[] = [
  { shape: "rect", mermaid: "rect", aliases: ["rect", "process", "proc", "rectangle"], label: "Rectangle", group: "Basic" },
  { shape: "rounded", mermaid: "rounded", aliases: ["rounded", "event"], label: "Rounded", group: "Basic" },
  { shape: "stadium", mermaid: "stadium", aliases: ["stadium", "terminal", "pill"], label: "Stadium", group: "Basic" },
  { shape: "diamond", mermaid: "diam", aliases: ["diam", "diamond", "decision", "question"], label: "Diamond", group: "Basic" },
  { shape: "circle", mermaid: "circle", aliases: ["circle", "circ"], label: "Circle", group: "Basic" },
  { shape: "doubleCircle", mermaid: "dbl-circ", aliases: ["dbl-circ", "double-circle"], label: "Double circle", group: "Basic" },
  { shape: "hexagon", mermaid: "hex", aliases: ["hex", "hexagon", "prepare"], label: "Hexagon", group: "Basic" },
  { shape: "text", mermaid: "text", aliases: ["text"], label: "Text (no border)", group: "Basic" },
  { shape: "subroutine", mermaid: "fr-rect", aliases: ["fr-rect", "subproc", "subroutine", "subprocess", "framed-rectangle"], label: "Subroutine (framed)", group: "Process" },
  { shape: "linRect", mermaid: "lin-rect", aliases: ["lin-rect", "lined-process", "lin-proc", "lined-rectangle", "shaded-process"], label: "Lined process", group: "Process" },
  { shape: "divRect", mermaid: "div-rect", aliases: ["div-rect", "divided-process", "div-proc", "divided-rectangle"], label: "Divided process", group: "Process" },
  { shape: "stRect", mermaid: "st-rect", aliases: ["st-rect", "stacked-rectangle", "processes", "procs"], label: "Stacked rectangle", group: "Process" },
  { shape: "tagRect", mermaid: "tag-rect", aliases: ["tag-rect", "tagged-rectangle", "tag-proc", "tagged-process"], label: "Tagged rectangle", group: "Process" },
  { shape: "notchRect", mermaid: "notch-rect", aliases: ["notch-rect", "card", "notched-rectangle"], label: "Card (notched)", group: "Process" },
  { shape: "slRect", mermaid: "sl-rect", aliases: ["sl-rect", "manual-input", "sloped-rectangle"], label: "Manual input", group: "Process" },
  { shape: "hourglass", mermaid: "hourglass", aliases: ["hourglass", "collate"], label: "Hourglass (collate)", group: "Process" },
  { shape: "parallelogram", mermaid: "lean-r", aliases: ["lean-r", "lean-right", "in-out"], label: "Parallelogram (lean right)", group: "Data" },
  { shape: "parallelogramAlt", mermaid: "lean-l", aliases: ["lean-l", "lean-left", "out-in"], label: "Parallelogram (lean left)", group: "Data" },
  { shape: "trapezoid", mermaid: "trap-b", aliases: ["trap-b", "trapezoid-bottom", "priority", "trapezoid"], label: "Trapezoid", group: "Data" },
  { shape: "trapezoidAlt", mermaid: "trap-t", aliases: ["trap-t", "trapezoid-top", "manual", "inv-trapezoid"], label: "Trapezoid (inverted)", group: "Data" },
  { shape: "cylinder", mermaid: "cyl", aliases: ["cyl", "cylinder", "database", "db"], label: "Cylinder (database)", group: "Data" },
  { shape: "linCyl", mermaid: "lin-cyl", aliases: ["lin-cyl", "disk", "lined-cylinder"], label: "Disk storage", group: "Data" },
  { shape: "doc", mermaid: "doc", aliases: ["doc", "document"], label: "Document", group: "Data" },
  { shape: "docs", mermaid: "docs", aliases: ["docs", "documents", "st-doc", "stacked-document"], label: "Stacked documents", group: "Data" },
  { shape: "bowRect", mermaid: "bow-rect", aliases: ["bow-rect", "stored-data", "bow-tie-rectangle"], label: "Stored data", group: "Data" },
  { shape: "winPane", mermaid: "win-pane", aliases: ["win-pane", "internal-storage", "window-pane"], label: "Internal storage", group: "Data" },
  { shape: "curvTrap", mermaid: "curv-trap", aliases: ["curv-trap", "display", "curved-trapezoid"], label: "Display", group: "Data" },
  { shape: "tri", mermaid: "tri", aliases: ["tri", "extract", "triangle"], label: "Extract (triangle)", group: "Data" },
  { shape: "flipTri", mermaid: "flip-tri", aliases: ["flip-tri", "manual-file", "flipped-triangle"], label: "Manual file", group: "Data" },
  { shape: "delay", mermaid: "delay", aliases: ["delay", "half-rounded-rectangle"], label: "Delay", group: "Flow" },
  { shape: "fork", mermaid: "fork", aliases: ["fork", "join"], label: "Fork / join", group: "Flow", noLabel: true },
  { shape: "smCirc", mermaid: "sm-circ", aliases: ["sm-circ", "start", "small-circle"], label: "Start (small circle)", group: "Flow", noLabel: true },
  { shape: "fCirc", mermaid: "f-circ", aliases: ["f-circ", "junction", "filled-circle"], label: "Junction (filled circle)", group: "Flow", noLabel: true },
  { shape: "crossCirc", mermaid: "cross-circ", aliases: ["cross-circ", "summary", "crossed-circle"], label: "Summary (crossed circle)", group: "Flow", noLabel: true },
  { shape: "asymmetric", mermaid: "odd", aliases: ["odd"], label: "Asymmetric (odd)", group: "Misc" },
  { shape: "bolt", mermaid: "bolt", aliases: ["bolt", "com-link", "lightning-bolt"], label: "Comm link (bolt)", group: "Misc" },
  { shape: "brace", mermaid: "brace", aliases: ["brace", "comment", "brace-l"], label: "Comment (brace)", group: "Misc" },
];

const byAlias = new Map<string, FlowchartNodeShape>();
for (const info of FLOWCHART_SHAPES) for (const a of info.aliases) if (!byAlias.has(a)) byAlias.set(a, info.shape);
const byShape = new Map<FlowchartNodeShape, FlowchartShapeInfo>(FLOWCHART_SHAPES.map((s) => [s.shape, s]));

/** Resolve a mermaid `@{ shape: name }` (any alias) to our shape, or undefined. */
export function flowchartShapeFromMermaid(name: string): FlowchartNodeShape | undefined {
  return byAlias.get(name);
}

export function flowchartShapeInfo(shape: FlowchartNodeShape): FlowchartShapeInfo {
  return byShape.get(shape)!;
}

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
  /** `direction X` inside the block. The layout honors it: a subgraph gets a
   * dagre graph of its own, so its rankdir is its own too. */
  readonly direction?: FlowchartDirection;
}

export type FlowchartLineStyle = "solid" | "dotted" | "thick" | "invisible";
export type FlowchartEdgeHead = "none" | "arrow" | "circle" | "cross";

/** Edges may attach to a subgraph as a whole, not just to nodes. */
export type FlowchartEndpoint = NodeId | SubgraphId;

export interface FlowchartEdge {
  readonly id: EdgeId;
  readonly from: FlowchartEndpoint;
  readonly to: FlowchartEndpoint;
  readonly label?: string;
  readonly line: FlowchartLineStyle;
  /** Head drawn at `from`. Mermaid only renders it when it matches headEnd
   * (`<-->`, `o--o`, `x--x`); other combinations parse but lose the head. */
  readonly headStart: FlowchartEdgeHead;
  readonly headEnd: FlowchartEdgeHead;
  /** Rank span (`-->` = 1, `--->` = 2, …). Absent = 1. */
  readonly length?: number;
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
