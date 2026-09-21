import {
  formatAttribute,
  formatMethod,
  type ClassIR,
  type ClassNode,
  type ClassRelation,
  type NamespaceId,
  type RelationHead,
} from "@gmermaid/ir";

// Heads are asymmetric in mermaid's text form: the same head kind is spelled
// differently at each end (`<|--` vs `--|>`), which is why the IR keeps
// line + head-per-end instead of a single named relation type.
const HEAD_FROM: Record<RelationHead, string> = {
  none: "",
  arrow: "<",
  inheritance: "<|",
  composition: "*",
  aggregation: "o",
  lollipop: "()",
};
const HEAD_TO: Record<RelationHead, string> = {
  none: "",
  arrow: ">",
  inheritance: "|>",
  composition: "*",
  aggregation: "o",
  lollipop: "()",
};

function escapeLabel(label: string): string {
  // Same entity set as the other diagram kinds: mermaid has no backslash
  // escape inside `"…"`, so quotes must travel as `#quot;`.
  return label
    .replaceAll("#", "#35;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;")
    .replaceAll('"', "#quot;")
    .replaceAll(/\r?\n/g, "<br/>");
}

/** Statement keywords the parser strips before it ever looks for a relation:
 * a bare name here would take the whole line with it. */
const RESERVED = new Set(["style", "classDef", "cssClass", "class", "link", "click", "callback", "note", "direction", "namespace", "accTitle", "accDescr"]);

/** Bare identifiers stay bare; anything else (spaces, `-`, punctuation) needs backticks. */
function ref(name: string): string {
  return /^[\p{L}\p{N}_.]+$/u.test(name) && !RESERVED.has(name) ? name : `\`${name}\``;
}

export function relationToken(r: ClassRelation): string {
  return `${HEAD_FROM[r.headFrom]}${r.line === "solid" ? "--" : ".."}${HEAD_TO[r.headTo]}`;
}

function classLines(c: ClassNode, indent: string): string[] {
  const head = `${ref(c.name)}${c.generic !== undefined ? `~${c.generic}~` : ""}${c.label !== undefined ? `["${escapeLabel(c.label)}"]` : ""}`;
  const members = [...c.attributes.map(formatAttribute), ...c.methods.map(formatMethod)];
  // annotations go INSIDE the block: mermaid takes only one inline `<<…>>`
  if (c.stereotypes.length === 0 && members.length === 0) return [`${indent}class ${head}`];
  return [
    `${indent}class ${head} {`,
    ...c.stereotypes.map((s) => `${indent}  <<${s}>>`),
    ...members.map((m) => `${indent}  ${m}`),
    `${indent}}`,
  ];
}

export function classToMermaid(ir: ClassIR): string {
  const lines = ["classDiagram"];
  if (ir.direction !== undefined) lines.push(`  direction ${ir.direction}`);
  const nameOf = new Map(ir.classes.map((c) => [c.id, c.name]));

  // A namespace block is emitted where its FIRST member sits, so the class
  // order survives the round trip (mermaid cannot reopen a namespace, so
  // members scattered through the list are pulled into that one block).
  const emitted = new Set<NamespaceId>();
  for (const c of ir.classes) {
    if (c.namespace === undefined) {
      lines.push(...classLines(c, "  "));
      continue;
    }
    if (emitted.has(c.namespace)) continue;
    emitted.add(c.namespace);
    const ns = ir.namespaces.find((n) => n.id === c.namespace);
    // an unknown namespace id would silently swallow the class — emit it flat
    if (ns === undefined) {
      lines.push(...classLines(c, "  "));
      continue;
    }
    lines.push(`  namespace ${ref(ns.name)} {`);
    for (const m of ir.classes) if (m.namespace === ns.id) lines.push(...classLines(m, "    "));
    lines.push("  }");
  }

  for (const r of ir.relations) {
    const from = nameOf.get(r.from) ?? r.from;
    const to = nameOf.get(r.to) ?? r.to;
    // cardinalities and the label are free text: a `"` would close the
    // cardinality slot and a newline would end the statement, so they travel
    // as entities like every other label in this file
    const fromCard = r.fromCardinality !== undefined ? ` "${escapeLabel(r.fromCardinality)}"` : "";
    const toCard = r.toCardinality !== undefined ? `"${escapeLabel(r.toCardinality)}" ` : "";
    const label = r.label !== undefined ? ` : ${escapeLabel(r.label)}` : "";
    lines.push(`  ${ref(from)}${fromCard} ${relationToken(r)} ${toCard}${ref(to)}${label}`);
  }

  for (const n of ir.notes) {
    const target = n.target !== undefined ? `for ${ref(nameOf.get(n.target) ?? n.target)} ` : "";
    lines.push(`  note ${target}"${escapeLabel(n.text)}"`);
  }
  return lines.join("\n") + "\n";
}
