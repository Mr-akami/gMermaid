import { ER_LEFT_GLYPH, ER_RIGHT_GLYPH, type ErIR } from "@gmermaid/ir";

// Quoted values accept everything a bare value cannot, so free text (names
// with spaces, labels, comments) is emitted quoted with the same entity set
// as the other diagram kinds.
function escapeText(text: string): string {
  return text
    .replaceAll("#", "#35;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;")
    .replaceAll('"', "#quot;")
    .replaceAll(/\r?\n/g, "<br/>");
}

const BARE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Words the mermaid lexer (or our own drop list) claims before the name rule
// gets a chance — and the cardinality spellings (`one or more`, `only one`)
// — so such names must be quoted.
const KEYWORDS = new Set<string>([
  "erDiagram",
  "direction",
  "style",
  "classDef",
  "class",
  "click",
  "cssClass",
  "linkStyle",
  "accTitle",
  "accDescr",
  "title",
  "one",
  "only",
  "zero",
  "many",
  "to",
  "or",
]);

/** Mermaid spelling of an entity name: bare identifier, or quoted otherwise. */
export function formatErName(name: string): string {
  return BARE_NAME_RE.test(name) && !KEYWORDS.has(name) ? name : `"${escapeText(name)}"`;
}

export function erToMermaid(ir: ErIR): string {
  const lines = ["erDiagram"];
  if (ir.direction !== undefined) lines.push(`  direction ${ir.direction}`);
  const nameOf = new Map(ir.entities.map((e) => [e.id as string, e.name]));

  for (const e of ir.entities) {
    const head = `${formatErName(e.name)}${e.alias !== undefined ? `["${escapeText(e.alias)}"]` : ""}`;
    if (e.attributes.length === 0) {
      lines.push(`  ${head}`);
      continue;
    }
    lines.push(`  ${head} {`);
    for (const a of e.attributes) {
      const keys = a.keys.length > 0 ? ` ${a.keys.join(", ")}` : "";
      const comment = a.comment !== undefined ? ` "${escapeText(a.comment)}"` : "";
      lines.push(`    ${a.type} ${a.name}${keys}${comment}`);
    }
    lines.push("  }");
  }

  for (const r of ir.relationships) {
    const from = formatErName(nameOf.get(r.from) ?? r.from);
    const to = formatErName(nameOf.get(r.to) ?? r.to);
    const line = r.identifying ? "--" : "..";
    // mermaid requires the `: label` part; an empty quoted label is "none"
    const label = `"${escapeText(r.label ?? "")}"`;
    lines.push(`  ${from} ${ER_LEFT_GLYPH[r.fromCard]}${line}${ER_RIGHT_GLYPH[r.toCard]} ${to} : ${label}`);
  }
  return lines.join("\n") + "\n";
}
