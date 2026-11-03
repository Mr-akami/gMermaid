import { archGroupsParentFirst, normalizeArchEdge, type ArchEdge, type ArchGroup, type ArchJunction, type ArchService, type ArchitectureIR } from "@gmermaid/ir";

// Titles always go inside double quotes (a bare `[…]` cannot hold `]`), and
// the entity set shared with the other diagram kinds reads back through the
// same `unescapeLabel`. A title lives on one line.
function escapeLabel(label: string): string {
  return label
    .replaceAll("#", "#35;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;")
    .replaceAll('"', "#quot;")
    .replaceAll(/\s*[\r\n]+\s*/g, " ");
}

const icon = (name: string | undefined): string => (name !== undefined ? `(${name})` : "");
const title = (label: string | undefined): string => (label !== undefined ? `["${escapeLabel(label)}"]` : "");

function groupDecl(g: ArchGroup, nameOf: (id: string) => string): string {
  const parent = g.parent !== undefined ? ` in ${nameOf(g.parent)}` : "";
  return `group ${g.name}${icon(g.icon)}${title(g.label)}${parent}`;
}

function serviceDecl(s: ArchService, nameOf: (id: string) => string): string {
  const parent = s.group !== undefined ? ` in ${nameOf(s.group)}` : "";
  return `service ${s.name}${icon(s.icon)}${title(s.label)}${parent}`;
}

function junctionDecl(j: ArchJunction, nameOf: (id: string) => string): string {
  return `junction ${j.name}${j.group !== undefined ? ` in ${nameOf(j.group)}` : ""}`;
}

function edgeLine(e: ArchEdge, nameOf: (id: string) => string): string {
  const left = `${nameOf(e.from)}${e.groupFrom === true ? "{group}" : ""}:${e.fromSide}`;
  const right = `${e.toSide}:${nameOf(e.to)}${e.groupTo === true ? "{group}" : ""}`;
  const arrowFrom = e.arrowFrom ? "<" : "";
  const arrowTo = e.arrowTo ? ">" : "";
  const body = e.label !== undefined ? `-["${escapeLabel(e.label)}"]-` : "--";
  return `${left} ${arrowFrom}${body}${arrowTo} ${right}`;
}

export function architectureToMermaid(ir: ArchitectureIR): string {
  const lines = ["architecture-beta"];
  const nameOf = (id: string): string =>
    ir.groups.find((g) => g.id === id)?.name ??
    ir.services.find((s) => s.id === id)?.name ??
    ir.junctions.find((j) => j.id === id)?.name ??
    id;

  // mermaid registers every group, then every service, then every junction,
  // then the edges — and a parent has to be declared before its children
  for (const g of archGroupsParentFirst(ir)) lines.push(`  ${groupDecl(g, nameOf)}`);
  for (const s of ir.services) lines.push(`  ${serviceDecl(s, nameOf)}`);
  for (const j of ir.junctions) lines.push(`  ${junctionDecl(j, nameOf)}`);
  for (const e of ir.edges) lines.push(`  ${edgeLine(normalizeArchEdge(ir, e), nameOf)}`);

  return lines.join("\n") + "\n";
}
