import type { FlowchartEdge, FlowchartIR, FlowchartNode } from "@gmermaid/ir";

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
  }
}

function arrowToken(edge: FlowchartEdge): string {
  switch (edge.arrow) {
    case "arrow":
      return "-->";
    case "open":
      return "---";
    case "dotted":
      return "-.->";
    case "thick":
      return "==>";
    case "invisible":
      return "~~~";
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
  for (const node of ir.nodes) {
    lines.push(`  ${nodeDecl(node)}`);
  }
  for (const edge of ir.edges) {
    const arrow = arrowToken(edge);
    // invisible links cannot carry a label in mermaid
    const label = edge.label !== undefined && edge.arrow !== "invisible" ? `|"${escapeLabel(edge.label)}"|` : "";
    lines.push(`  ${edge.from} ${arrow}${label} ${edge.to}`);
  }
  return lines.join("\n") + "\n";
}
