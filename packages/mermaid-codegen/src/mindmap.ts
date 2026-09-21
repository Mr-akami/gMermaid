import { mindmapChildren, mindmapRoot, type MindmapIR, type MindmapNode } from "@gmermaid/ir";

// Canonical form: two spaces of indentation per depth (starting at 2), the
// shape's bracket pair with a QUOTED label, then the node's `::icon(…)` and
// `:::class` lines at the same indentation. Quoting is what makes brackets
// and parentheses inside a label survive mermaid's lexer; the default shape
// has no brackets to quote inside, so those characters are escaped as
// numeric entities there (mermaid rejects them raw, and a quoted bare line
// is not a valid node either).

function escapeLabel(label: string): string {
  return label
    .replaceAll("#", "#35;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;")
    .replaceAll('"', "#quot;")
    .replaceAll(/\r?\n/g, "<br/>");
}

const BARE_ENTITIES: readonly (readonly [string, string])[] = [
  ["(", "#40;"],
  [")", "#41;"],
  ["[", "#91;"],
  ["]", "#93;"],
  ["{", "#123;"],
  ["}", "#125;"],
];

/** The default shape is written as bare text, where mermaid's lexer stops at
 * any bracket — entities keep such a label expressible. */
function escapeBare(label: string): string {
  let out = escapeLabel(label);
  for (const [char, entity] of BARE_ENTITIES) out = out.replaceAll(char, entity);
  return out;
}

function nodeText(node: MindmapNode): string {
  const label = escapeLabel(node.label);
  switch (node.shape) {
    case "square":
      return `${node.id}["${label}"]`;
    case "rounded":
      return `${node.id}("${label}")`;
    case "circle":
      return `${node.id}(("${label}"))`;
    case "bang":
      return `${node.id}))"${label}"((`;
    case "cloud":
      return `${node.id})"${label}"(`;
    case "hexagon":
      return `${node.id}{{"${label}"}}`;
    case "default":
      // no room for an id in this form: mermaid uses the text as the id
      return escapeBare(node.label);
  }
}

export function mindmapToMermaid(ir: MindmapIR): string {
  const lines = ["mindmap"];

  const emit = (node: MindmapNode, depth: number): void => {
    const indent = "  ".repeat(depth + 1);
    lines.push(`${indent}${nodeText(node)}`);
    if (node.icon !== undefined) lines.push(`${indent}::icon(${node.icon})`);
    if (node.classes !== undefined && node.classes.length > 0) lines.push(`${indent}:::${node.classes.join(" ")}`);
    for (const child of mindmapChildren(ir, node.id)) emit(child, depth + 1);
  };

  const root = mindmapRoot(ir);
  if (root) emit(root, 0);

  return lines.join("\n") + "\n";
}
