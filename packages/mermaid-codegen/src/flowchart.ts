import {
  flowchartShapeInfo,
  type FlowchartEdge,
  type FlowchartEdgeHead,
  type FlowchartIR,
  type FlowchartNode,
  type FlowchartSubgraph,
  type SubgraphId,
} from "@gmermaid/ir";

// bracket forms where mermaid has one; every other shape only exists as
// `id@{ shape: name, label: "…" }`
function nodeDecl(node: FlowchartNode): string {
  const label = escapeLabel(node.label);
  switch (node.shape) {
    case "rect":
      return `${node.id}["${label}"]`;
    case "rounded":
      return `${node.id}("${label}")`;
    case "stadium":
      return `${node.id}(["${label}"])`;
    case "diamond":
      return `${node.id}{"${label}"}`;
    case "circle":
      return `${node.id}(("${label}"))`;
    case "subroutine":
      return `${node.id}[["${label}"]]`;
    case "cylinder":
      return `${node.id}[("${label}")]`;
    case "hexagon":
      return `${node.id}{{"${label}"}}`;
    case "asymmetric":
      return `${node.id}>"${label}"]`;
    case "doubleCircle":
      return `${node.id}((("${label}")))`;
    case "parallelogram":
      return `${node.id}[/"${label}"/]`;
    case "parallelogramAlt":
      return `${node.id}[\\"${label}"\\]`;
    case "trapezoid":
      return `${node.id}[/"${label}"\\]`;
    case "trapezoidAlt":
      return `${node.id}[\\"${label}"/]`;
    default:
      return `${node.id}@{ shape: ${flowchartShapeInfo(node.shape).mermaid}, label: "${label}" }`;
  }
}

const HEAD_START: Record<FlowchartEdgeHead, string> = { none: "", arrow: "<", circle: "o", cross: "x" };
const HEAD_END: Record<FlowchartEdgeHead, string> = { none: "", arrow: ">", circle: "o", cross: "x" };

/** `-->`, `o-.-o`, `<-->`, `~~~`; extra line chars per unit of length.
 * Mermaid only has tokens for a SYMMETRIC pair of heads (`<-->`, `o--o`,
 * `x--x`) — `o---` reads back as a plain open link. That invariant now lives
 * in the reducer (`normalizeFlowchartEdge`), so the mismatch branch below is
 * unreachable; it stays as a belt-and-braces guard against emitting a lie. */
export function edgeToken(edge: FlowchartEdge): string {
  const n = edge.length ?? 1;
  const start = edge.headStart === edge.headEnd ? HEAD_START[edge.headStart] : "";
  const end = HEAD_END[edge.headEnd];
  switch (edge.line) {
    case "solid":
      // `--` + head, or `---` when there is no head: the last `-` fills the head slot
      return `${start}${"-".repeat(n + 1)}${end || "-"}`;
    case "dotted":
      return `${start}-${".".repeat(n)}-${end}`;
    case "thick":
      return `${start}${"=".repeat(n + 1)}${end || "="}`;
    case "invisible":
      // `~~~` has no head slot at either end; the reducer guarantees both
      // heads are already "none" here
      return "~".repeat(n + 2);
  }
}

function escapeLabel(label: string): string {
  // Order matters: "#" starts a mermaid entity, so escape it before
  // introducing entities of our own; "<"/">" must go before the literal
  // <br/> we emit for newlines (mermaid renders labels as HTML by default).
  return label
    .replaceAll("#", "#35;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;")
    .replaceAll('"', "#quot;")
    .replaceAll(/\r?\n/g, "<br/>");
}

export function flowchartToMermaid(ir: FlowchartIR): string {
  const lines = [`flowchart ${ir.direction}`];

  const nodesIn = new Map<SubgraphId | undefined, FlowchartNode[]>();
  for (const node of ir.nodes) {
    const list = nodesIn.get(node.parent) ?? [];
    list.push(node);
    nodesIn.set(node.parent, list);
  }
  const subgraphsIn = new Map<SubgraphId | undefined, FlowchartSubgraph[]>();
  for (const s of ir.subgraphs) {
    const list = subgraphsIn.get(s.parent) ?? [];
    list.push(s);
    subgraphsIn.set(s.parent, list);
  }

  // membership is positional in mermaid text: everything declared inside a
  // `subgraph … end` block belongs to it, so blocks re-declare their members
  const emitScope = (container: SubgraphId | undefined, indent: string): void => {
    for (const node of nodesIn.get(container) ?? []) {
      lines.push(`${indent}${nodeDecl(node)}`);
    }
    for (const s of subgraphsIn.get(container) ?? []) {
      lines.push(`${indent}subgraph ${s.id}["${escapeLabel(s.label)}"]`);
      if (s.direction !== undefined) lines.push(`${indent}  direction ${s.direction}`);
      emitScope(s.id, indent + "  ");
      lines.push(`${indent}end`);
    }
  };
  emitScope(undefined, "  ");

  for (const edge of ir.edges) {
    const arrow = edgeToken(edge);
    // invisible links cannot carry a label in mermaid
    const label = edge.label !== undefined && edge.line !== "invisible" ? `|"${escapeLabel(edge.label)}"|` : "";
    lines.push(`  ${edge.from} ${arrow}${label} ${edge.to}`);
  }
  return lines.join("\n") + "\n";
}
