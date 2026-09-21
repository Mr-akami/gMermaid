import { REQUIREMENT_RELATION_TYPES, REQUIREMENT_TYPES, type RequirementIR } from "@gmermaid/ir";

// Quoted values accept everything a bare value cannot (`:`, `,`, `->`,
// non-ASCII, keywords), so every free-text field is emitted quoted with the
// same entity set as the other diagram kinds.
function escapeText(text: string): string {
  return text
    .replaceAll("#", "#35;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;")
    .replaceAll('"', "#quot;")
    .replaceAll(/\r?\n/g, "<br/>");
}

const BARE_NAME_RE = /^[A-Za-z0-9_.]+$/;
// Statement-leading keywords the mermaid lexer would claim before the name
// rule gets a chance — such names must be quoted.
const KEYWORDS = new Set<string>([
  ...REQUIREMENT_TYPES,
  ...REQUIREMENT_RELATION_TYPES,
  "element",
  "direction",
  "style",
  "classDef",
  "class",
  "requirementDiagram",
  "id",
  "text",
  "risk",
  "verifymethod",
  "type",
  "docref",
]);

/** Mermaid spelling of a node name: bare identifier, or quoted otherwise. */
export function formatRequirementName(name: string): string {
  return BARE_NAME_RE.test(name) && !KEYWORDS.has(name) ? name : `"${escapeText(name)}"`;
}

export function requirementToMermaid(ir: RequirementIR): string {
  const lines = ["requirementDiagram"];
  if (ir.direction !== undefined) lines.push(`  direction ${ir.direction}`);
  const nameOf = new Map<string, string>([
    ...ir.requirements.map((r): [string, string] => [r.id, r.name]),
    ...ir.elements.map((e): [string, string] => [e.id, e.name]),
  ]);

  for (const r of ir.requirements) {
    lines.push(`  ${r.type} ${formatRequirementName(r.name)} {`);
    if (r.reqId !== undefined) lines.push(`    id: "${escapeText(r.reqId)}"`);
    if (r.text !== undefined) lines.push(`    text: "${escapeText(r.text)}"`);
    if (r.risk !== undefined) lines.push(`    risk: ${r.risk.toLowerCase()}`);
    if (r.verifyMethod !== undefined) lines.push(`    verifymethod: ${r.verifyMethod.toLowerCase()}`);
    lines.push("  }");
  }

  for (const e of ir.elements) {
    lines.push(`  element ${formatRequirementName(e.name)} {`);
    if (e.type !== undefined) lines.push(`    type: "${escapeText(e.type)}"`);
    if (e.docRef !== undefined) lines.push(`    docref: "${escapeText(e.docRef)}"`);
    lines.push("  }");
  }

  for (const r of ir.relations) {
    const from = formatRequirementName(nameOf.get(r.from) ?? r.from);
    const to = formatRequirementName(nameOf.get(r.to) ?? r.to);
    lines.push(`  ${from} - ${r.type} -> ${to}`);
  }
  return lines.join("\n") + "\n";
}
