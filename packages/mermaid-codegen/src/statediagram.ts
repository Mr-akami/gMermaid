import type { StateIR, StateId, StateNode, StateTransition } from "@gmermaid/ir";

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

const PSEUDO_DECL: Partial<Record<StateNode["role"], string>> = {
  choice: "<<choice>>",
  fork: "<<fork>>",
  join: "<<join>>",
};

/** [*] is positional in the text form: the IR's start/end roles map back. */
function ref(s: StateNode): string {
  return s.role === "start" || s.role === "end" ? "[*]" : s.id;
}

export function stateToMermaid(ir: StateIR): string {
  const lines = ["stateDiagram-v2"];
  if (ir.direction !== undefined) lines.push(`  direction ${ir.direction}`);

  const byId = new Map(ir.states.map((s) => [s.id, s]));
  const children = new Map<StateId | undefined, StateNode[]>();
  for (const s of ir.states) {
    const list = children.get(s.parent) ?? [];
    list.push(s);
    children.set(s.parent, list);
  }
  const referenced = new Set(ir.transitions.flatMap((t) => [t.from, t.to]));

  // [*] is scoped to its block, so a transition touching a start/end
  // pseudo-state must be emitted inside that pseudo-state's container.
  const containerOf = (t: StateTransition): StateId | undefined => {
    const from = byId.get(t.from);
    const to = byId.get(t.to);
    if (from !== undefined && (from.role === "start" || from.role === "end")) return from.parent;
    if (to !== undefined && (to.role === "start" || to.role === "end")) return to.parent;
    return undefined;
  };
  const transitionsIn = new Map<StateId | undefined, StateTransition[]>();
  for (const t of ir.transitions) {
    const c = containerOf(t);
    const list = transitionsIn.get(c) ?? [];
    list.push(t);
    transitionsIn.set(c, list);
  }

  const emitTransition = (t: StateTransition, indent: string): void => {
    const from = byId.get(t.from);
    const to = byId.get(t.to);
    if (!from || !to) return;
    const label = t.label !== undefined ? ` : ${escapeLabel(t.label)}` : "";
    lines.push(`${indent}${ref(from)} --> ${ref(to)}${label}`);
  };

  const emitScope = (container: StateId | undefined, indent: string): void => {
    for (const s of children.get(container) ?? []) {
      if (s.role === "start" || s.role === "end") continue; // [*] never needs a declaration
      const pseudo = PSEUDO_DECL[s.role];
      const isComposite = (children.get(s.id) ?? []).length > 0;
      if (pseudo !== undefined) {
        lines.push(`${indent}state ${s.id} ${pseudo}`);
      } else if (isComposite) {
        const head = s.label !== s.id ? `state "${escapeLabel(s.label)}" as ${s.id}` : `state ${s.id}`;
        lines.push(`${indent}${head} {`);
        emitScope(s.id, indent + "  ");
        lines.push(`${indent}}`);
        continue;
      } else if (s.label !== s.id) {
        lines.push(`${indent}state "${escapeLabel(s.label)}" as ${s.id}`);
      } else if (container !== undefined || !referenced.has(s.id)) {
        // top-level states a transition mentions are declared implicitly, in
        // order; block members are ALWAYS declared to pin their membership
        lines.push(`${indent}state ${s.id}`);
      }
    }
    for (const t of transitionsIn.get(container) ?? []) emitTransition(t, indent);
  };

  emitScope(undefined, "  ");

  for (const n of ir.notes) {
    if (!byId.has(n.target)) continue;
    const pos = n.position === "leftOf" ? "left of" : "right of";
    lines.push(`  note ${pos} ${n.target} : ${escapeLabel(n.text)}`);
  }

  return lines.join("\n") + "\n";
}
