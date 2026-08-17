import { formatAttribute, formatMethod, type ClassIR, type RelationType } from "@gmermaid/ir";

const REL_TOKEN: Record<RelationType, string> = {
  inheritance: "--|>",
  composition: "--*",
  aggregation: "--o",
  association: "-->",
  dependency: "..>",
  realization: "..|>",
};

export function classToMermaid(ir: ClassIR): string {
  const lines = ["classDiagram"];
  const nameOf = new Map(ir.classes.map((c) => [c.id, c.name]));

  for (const c of ir.classes) {
    if (c.stereotype === undefined && c.attributes.length === 0 && c.methods.length === 0) {
      lines.push(`  class ${c.name}`);
      continue;
    }
    lines.push(`  class ${c.name} {`);
    if (c.stereotype !== undefined) lines.push(`    <<${c.stereotype}>>`);
    for (const a of c.attributes) lines.push(`    ${formatAttribute(a)}`);
    for (const m of c.methods) lines.push(`    ${formatMethod(m)}`);
    lines.push("  }");
  }

  for (const r of ir.relations) {
    const from = nameOf.get(r.from) ?? r.from;
    const to = nameOf.get(r.to) ?? r.to;
    const fromCard = r.fromCardinality !== undefined ? ` "${r.fromCardinality}"` : "";
    const toCard = r.toCardinality !== undefined ? `"${r.toCardinality}" ` : "";
    const label = r.label !== undefined ? ` : ${r.label}` : "";
    lines.push(`  ${from}${fromCard} ${REL_TOKEN[r.type]} ${toCard}${to}${label}`);
  }
  return lines.join("\n") + "\n";
}
