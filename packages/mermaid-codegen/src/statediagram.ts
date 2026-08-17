import type { StateIR, StateNode } from "@gmermaid/ir";

function escapeLabel(label: string): string {
  // State labels sit inside double quotes or after `:` — same entity set as
  // the other diagram kinds.
  return label
    .replaceAll("#", "#35;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;")
    .replaceAll('"', "#quot;")
    .replaceAll(/\r?\n/g, "<br/>");
}

/** [*] is positional in the text form: the IR's start/end roles map back. */
function ref(s: StateNode): string {
  return s.role === "normal" ? s.id : "[*]";
}

export function stateToMermaid(ir: StateIR): string {
  const lines = ["stateDiagram-v2"];
  if (ir.direction !== undefined) lines.push(`  direction ${ir.direction}`);
  const byId = new Map(ir.states.map((s) => [s.id, s]));
  const referenced = new Set(ir.transitions.flatMap((t) => [t.from, t.to]));
  for (const s of ir.states) {
    if (s.role !== "normal") continue; // [*] never needs a declaration
    // states a transition already mentions are declared implicitly, in
    // order — an explicit decl would reshuffle them on the next import
    if (s.label !== s.id) lines.push(`  state "${escapeLabel(s.label)}" as ${s.id}`);
    else if (!referenced.has(s.id)) lines.push(`  state ${s.id}`);
  }
  for (const t of ir.transitions) {
    const from = byId.get(t.from);
    const to = byId.get(t.to);
    if (!from || !to) continue;
    const label = t.label !== undefined ? ` : ${escapeLabel(t.label)}` : "";
    lines.push(`  ${ref(from)} --> ${ref(to)}${label}`);
  }
  return lines.join("\n") + "\n";
}
