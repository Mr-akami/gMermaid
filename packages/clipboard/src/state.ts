import type { StateId, StateIR, StateNode, StateNote, StateTransition } from "@gmermaid/ir";
import { newId, newStateId, omitUndefined, stateNoteRejection } from "@gmermaid/ir";
import type { KindClipboard, MergeResult } from "./kind";
import { saturate } from "./kind";

const scopeKey = (s: { parent?: StateId; region?: number }) => `${s.parent ?? ""}\u0000${s.region ?? 0}`;

/** Closure: a state pulls its composite subtree, a transition pulls both
 * endpoints, a parent left behind is dropped — and because `[*]` is scoped
 * to one start and one end per container region, promoted duplicates fold
 * onto the first. See the header comment in `clipboard.ts`. */
function slice(ir: StateIR, ids: ReadonlySet<string>): StateIR | undefined {
  const seed: string[] = ir.states.filter((s) => ids.has(s.id)).map((s) => s.id);
  for (const t of ir.transitions) {
    if (!ids.has(t.id)) continue;
    seed.push(t.from, t.to);
  }
  for (const n of ir.notes) if (ids.has(n.id)) seed.push(n.target);

  const known = new Set<string>(ir.states.map((s) => s.id));
  const kept = saturate(
    seed.filter((id) => known.has(id)),
    (have) => ir.states.filter((s) => s.parent !== undefined && have.has(s.parent)).map((s) => s.id),
  );
  if (kept.size === 0) return undefined;

  // promote what lost its container, then fold the `[*]` duplicates that
  // promotion can create: one start and one end per container region
  const promoted: StateNode[] = ir.states
    .filter((s) => kept.has(s.id))
    .map((s) =>
      s.parent !== undefined && kept.has(s.parent) ? s : omitUndefined({ ...s, parent: undefined, region: undefined }),
    );

  const fold = new Map<string, StateId>();
  const pseudoSeen = new Map<string, StateId>();
  const states: StateNode[] = [];
  for (const s of promoted) {
    if (s.role === "start" || s.role === "end") {
      const key = `${s.role}\u0000${scopeKey(s)}`;
      const first = pseudoSeen.get(key);
      if (first !== undefined) {
        fold.set(s.id, first);
        continue;
      }
      pseudoSeen.set(key, s.id);
    }
    states.push(s);
  }

  const live = new Set<string>(states.map((s) => s.id));
  const ref = (id: StateId): StateId => fold.get(id) ?? id;
  const noteTargets = new Map(states.map((s) => [s.id as string, s]));

  return omitUndefined({
    kind: "state" as const,
    direction: ir.direction,
    states,
    transitions: ir.transitions
      .filter((t) => live.has(ref(t.from)) && live.has(ref(t.to)))
      .map((t) => ({ ...t, from: ref(t.from), to: ref(t.to) })),
    notes: ir.notes.filter((n) => {
      const target = noteTargets.get(ref(n.target));
      return target !== undefined && stateNoteRejection(target) === undefined;
    }),
    // machine-level XState detail names the machine, not the selection, and
    // mermaid cannot spell it anyway (ADR 0002)
    xstate: undefined,
  });
}

function merge(ir: StateIR, inc: StateIR): MergeResult<StateIR> {
  if (inc.states.length === 0) return { reason: "the clipboard holds an empty state diagram" };

  // a pasted top-level `[*]` MERGES with the one already there: two of them
  // in one region is exactly what `reparentRejection` forbids, and re-using
  // the existing one keeps `[*] --> X` meaning what it says
  const existingPseudo = new Map<string, StateId>();
  for (const s of ir.states) {
    if (s.role === "start" || s.role === "end") existingPseudo.set(`${s.role}\u0000${scopeKey(s)}`, s.id);
  }

  const map = new Map<string, StateId>();
  const fresh: StateNode[] = [];
  const mintedPseudo = new Map<string, StateId>();

  for (const s of inc.states) {
    const parent = s.parent === undefined ? undefined : map.get(s.parent);
    if (s.role === "start" || s.role === "end") {
      const key = `${s.role}\u0000${parent ?? ""}\u0000${parent === undefined ? 0 : (s.region ?? 0)}`;
      const shared = parent === undefined ? existingPseudo.get(`${s.role}\u0000\u00000`) : undefined;
      const already = mintedPseudo.get(key);
      if (shared !== undefined) {
        map.set(s.id, shared);
        continue;
      }
      if (already !== undefined) {
        map.set(s.id, already);
        continue;
      }
      const id = newStateId();
      mintedPseudo.set(key, id);
      map.set(s.id, id);
      fresh.push(omitUndefined({ ...s, id, parent, region: parent === undefined ? undefined : s.region }));
      continue;
    }
    const id = newStateId();
    map.set(s.id, id);
    fresh.push(omitUndefined({ ...s, id, parent, region: parent === undefined ? undefined : s.region }));
  }

  const transitions: StateTransition[] = inc.transitions.flatMap((t) => {
    const from = map.get(t.from);
    const to = map.get(t.to);
    if (from === undefined || to === undefined) return [];
    return [{ ...t, id: newId("transition"), from, to }];
  });

  const byId = new Map<string, StateNode>([...ir.states, ...fresh].map((s) => [s.id as string, s]));
  const notes: StateNote[] = inc.notes.flatMap((n) => {
    const target = map.get(n.target);
    if (target === undefined) return [];
    const node = byId.get(target);
    // never on a `[*]`: it has no name in the text to hang a note off
    if (node === undefined || stateNoteRejection(node) !== undefined) return [];
    return [{ ...n, id: newId("note"), target }];
  });

  return {
    // `direction` is the target's: a paste must not re-orient the diagram
    ir: { ...ir, states: [...ir.states, ...fresh], transitions: [...ir.transitions, ...transitions], notes: [...ir.notes, ...notes] },
    added: [...fresh.map((s) => s.id as string), ...transitions.map((t) => t.id as string), ...notes.map((n) => n.id as string)],
  };
}

export const stateClipboard: KindClipboard<StateIR> = { slice, merge };
