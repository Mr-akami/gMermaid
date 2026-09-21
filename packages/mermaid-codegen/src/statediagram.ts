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

/** Container + concurrency region a block member (or [*]) belongs to. */
type ScopeKey = string;
const scopeKey = (parent: StateId | undefined, region: number): ScopeKey => `${parent ?? ""}\u0000${region}`;

export function stateToMermaid(ir: StateIR): string {
  const lines = ["stateDiagram-v2"];
  if (ir.direction !== undefined) lines.push(`  direction ${ir.direction}`);

  const byId = new Map(ir.states.map((s) => [s.id, s]));
  // children grouped by container, then by region (ascending; gaps collapse
  // because mermaid cannot express an empty region)
  const regionsOf = new Map<StateId | undefined, Map<number, StateNode[]>>();
  for (const s of ir.states) {
    const regions = regionsOf.get(s.parent) ?? new Map<number, StateNode[]>();
    const list = regions.get(s.region ?? 0) ?? [];
    list.push(s);
    regions.set(s.region ?? 0, list);
    regionsOf.set(s.parent, regions);
  }
  const regionGroups = (container: StateId | undefined): StateNode[][] =>
    [...(regionsOf.get(container) ?? new Map<number, StateNode[]>()).entries()]
      .toSorted((a, b) => a[0] - b[0])
      .map(([, members]) => members);
  const isComposite = (id: StateId): boolean => regionsOf.has(id);
  const referenced = new Set(ir.transitions.flatMap((t) => [t.from, t.to]));

  // [*] is scoped to its block region, so a transition touching a start/end
  // pseudo-state must be emitted inside that pseudo-state's region.
  const scopeOf = (t: StateTransition): ScopeKey => {
    const from = byId.get(t.from);
    const to = byId.get(t.to);
    if (from !== undefined && (from.role === "start" || from.role === "end")) return scopeKey(from.parent, from.region ?? 0);
    if (to !== undefined && (to.role === "start" || to.role === "end")) return scopeKey(to.parent, to.region ?? 0);
    return scopeKey(undefined, 0);
  };
  const transitionsIn = new Map<ScopeKey, StateTransition[]>();
  for (const t of ir.transitions) {
    const c = scopeOf(t);
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
    const groups = regionGroups(container);
    groups.forEach((members, gi) => {
      if (gi > 0) lines.push(`${indent}--`);
      for (const s of members) {
        if (s.role === "start" || s.role === "end") continue; // [*] never needs a declaration
        const pseudo = PSEUDO_DECL[s.role];
        if (pseudo !== undefined) {
          lines.push(`${indent}state ${s.id} ${pseudo}`);
        } else if (isComposite(s.id)) {
          const head = s.label !== s.id ? `state "${escapeLabel(s.label)}" as ${s.id}` : `state ${s.id}`;
          lines.push(`${indent}${head} {`);
          if (s.direction !== undefined) lines.push(`${indent}  direction ${s.direction}`);
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
      const region = members[0]?.region ?? 0;
      for (const t of transitionsIn.get(scopeKey(container, region)) ?? []) emitTransition(t, indent);
    });
  };

  emitScope(undefined, "  ");

  for (const n of ir.notes) {
    if (!byId.has(n.target)) continue;
    const pos = n.position === "leftOf" ? "left of" : "right of";
    const noteLines = n.text.split(/\r?\n/);
    if (noteLines.length > 1) {
      // block form keeps the line breaks readable in the text (mermaid also
      // accepts `<br/>`, but nobody wants to read that)
      lines.push(`  note ${pos} ${n.target}`);
      for (const l of noteLines) lines.push(`    ${escapeLabel(l)}`);
      lines.push("  end note");
    } else {
      lines.push(`  note ${pos} ${n.target} : ${escapeLabel(n.text)}`);
    }
  }

  return lines.join("\n") + "\n";
}
