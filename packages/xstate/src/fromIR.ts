import type { StateId, StateIR, StateNode, StateTransition, XValue } from "@gmermaid/ir";
import { parseRef, parseTransitionLabel, quoteKey, type XRef } from "./signature";

// StateIR → XState v5 source. The export half of the XState projection.
//
// What this cannot say is said OUT LOUD in `warnings` rather than dropped in
// silence: a mermaid concurrency region holding several states has no XState
// counterpart (XState's regions ARE states), so it is wrapped in a synthesized
// state and the user is told which one.

export interface XStateCode {
  readonly code: string;
  /** Losses of THIS projection, for the code pane to show. */
  readonly warnings: readonly string[];
}

// ---------------------------------------------------------------------------
// A tiny JS-literal writer. `raw` exists because `context` and the `setup`
// argument are carried as source text — they hold functions, which we refuse
// to interpret but must still hand back exactly as written.

type Js =
  | { readonly kind: "raw"; readonly text: string }
  | { readonly kind: "value"; readonly value: XValue }
  | { readonly kind: "obj"; readonly entries: readonly (readonly [string, Js])[] }
  | { readonly kind: "arr"; readonly items: readonly Js[] };

const raw = (text: string): Js => ({ kind: "raw", text });
const val = (value: XValue): Js => ({ kind: "value", value });
const obj = (entries: readonly (readonly [string, Js])[]): Js => ({ kind: "obj", entries });
const arr = (items: readonly Js[]): Js => ({ kind: "arr", items });

function render(node: Js, indent: string): string {
  switch (node.kind) {
    case "raw":
      // a carried-through block keeps its own inner layout; only re-indent
      // the continuation lines so it sits under its key
      return node.text.split("\n").join(`\n${indent}`);
    case "value":
      return JSON.stringify(node.value);
    case "arr": {
      if (node.items.length === 0) return "[]";
      const inner = indent + "  ";
      return `[\n${node.items.map((i) => `${inner}${render(i, inner)}`).join(",\n")},\n${indent}]`;
    }
    case "obj": {
      if (node.entries.length === 0) return "{}";
      const inner = indent + "  ";
      return `{\n${node.entries.map(([k, v]) => `${inner}${quoteKey(k)}: ${render(v, inner)}`).join(",\n")},\n${indent}}`;
    }
  }
}

// ---------------------------------------------------------------------------

/** xstate exports a config text may lean on; only the ones actually mentioned
 * in the carried `setup`/`context` source make it into the import. */
const HELPERS = [
  "assign",
  "raise",
  "sendTo",
  "sendParent",
  "enqueueActions",
  "spawnChild",
  "stopChild",
  "cancel",
  "emit",
  "log",
  "and",
  "or",
  "not",
  "stateIn",
  "fromPromise",
  "fromCallback",
  "fromObservable",
  "fromEventObservable",
  "fromTransition",
];

const regionOf = (s: StateNode): number => s.region ?? 0;
/** What `#…` has to say to reach this node: the explicit `id:` it carries, or
 * its mermaid id, which codegen then writes out as an `id:`. */
const xidOf = (s: StateNode): string => s.xstate?.xid ?? (s.id as string);

export function stateToXState(ir: StateIR): XStateCode {
  const warnings: string[] = [];
  const byId = new Map(ir.states.map((s) => [s.id as string, s]));

  const membersIn = (parent: StateId | undefined, region: number): StateNode[] =>
    ir.states.filter((s) => s.parent === parent && regionOf(s) === region);
  const regionCount = (parent: StateId): number => {
    let max = -1;
    for (const s of ir.states) if (s.parent === parent) max = Math.max(max, regionOf(s));
    return max + 1;
  };
  const isComposite = (id: StateId): boolean => ir.states.some((s) => s.parent === id);
  const isParallel = (s: StateNode): boolean => regionCount(s.id) > 1 || s.xstate?.parallel === true;

  // ---- keys -------------------------------------------------------------
  // XState keys are only sibling-unique, so they are assigned per scope. A
  // `[*]` end has no name in mermaid at all and becomes `final`.
  const keys = new Map<string, string>();
  function assignKeys(members: readonly StateNode[]): void {
    const taken = new Set<string>();
    for (const m of members) {
      if (m.role === "start") continue;
      const want = m.xstate?.key ?? (m.role === "end" ? "final" : (m.id as string));
      let key = want;
      for (let n = 2; taken.has(key); n++) key = `${want}_${n}`;
      if (key !== want) warnings.push(`two states want the key \`${want}\`; \`${m.id}\` is written as \`${key}\``);
      taken.add(key);
      keys.set(m.id as string, key);
    }
  }
  assignKeys(membersIn(undefined, 0));
  for (const s of ir.states) {
    if (!isComposite(s.id)) continue;
    for (let r = 0; r < Math.max(1, regionCount(s.id)); r++) assignKeys(membersIn(s.id, r));
  }
  const keyOf = (id: StateId): string => keys.get(id as string) ?? (id as string);

  // ---- transitions ------------------------------------------------------
  const outgoing = new Map<string, StateTransition[]>();
  const initialOf = new Map<string, StateId>(); // start-pseudo id → target
  for (const t of ir.transitions) {
    const from = byId.get(t.from as string);
    if (from === undefined || byId.get(t.to as string) === undefined) continue;
    if (from.role === "start") {
      if (initialOf.has(t.from as string)) warnings.push(`\`${from.parent ?? "the machine"}\` has more than one initial transition; only the first is kept`);
      else initialOf.set(t.from as string, t.to);
      continue;
    }
    if (from.role === "end") {
      warnings.push(`a transition leaves a \`[*]\` end state; XState has no such edge, so it is dropped`);
      continue;
    }
    const list = outgoing.get(t.from as string) ?? [];
    list.push(t);
    outgoing.set(t.from as string, list);
  }

  /** Nodes that need an explicit `id:` — every non-sibling target. */
  const needsId = new Set<string>();
  for (const [fromId, list] of outgoing) {
    const from = byId.get(fromId)!;
    for (const t of list) {
      if (t.xstate?.internal === true) continue;
      const to = byId.get(t.to as string)!;
      if (to.parent === from.parent && regionOf(to) === regionOf(from)) continue;
      needsId.add(to.id as string);
    }
  }
  for (const s of ir.states) if (s.xstate?.xid !== undefined) needsId.add(s.id as string);

  function targetJs(from: StateNode, to: StateNode): string {
    if (to.parent === from.parent && regionOf(to) === regionOf(from)) return keyOf(to.id);
    return `#${xidOf(to)}`;
  }

  function transitionJs(from: StateNode, t: StateTransition): Js {
    const sig = parseTransitionLabel(t.label);
    const entries: (readonly [string, Js])[] = [];
    const to = byId.get(t.to as string)!;
    const internal = t.xstate?.internal === true;
    if (!internal) entries.push(["target", val(targetJs(from, to))]);
    if (sig.guard !== undefined) entries.push(["guard", refJs(sig.guard)]);
    if (sig.actions.length > 0) entries.push(["actions", sig.actions.length === 1 ? refJs(sig.actions[0]!) : arr(sig.actions.map(refJs))]);
    if (t.xstate?.reenter === true) entries.push(["reenter", val(true)]);
    if (t.xstate?.description !== undefined) entries.push(["description", val(t.xstate.description)]);
    // the string shorthand is the same transition, just shorter
    if (entries.length === 1 && entries[0]![0] === "target") return val(targetJs(from, to));
    return obj(entries);
  }

  const refJs = (ref: XRef): Js => (ref.params === undefined ? val(ref.type) : obj([["type", val(ref.type)], ["params", val(ref.params)]]));
  const actionsJs = (sigs: readonly string[]): Js => {
    const refs = sigs.map(parseRef);
    return refs.length === 1 ? refJs(refs[0]!) : arr(refs.map(refJs));
  };

  /** `always` / `after` / `on` for one state, in the order a re-read rebuilds. */
  function transitionEntries(s: StateNode): (readonly [string, Js])[] {
    const list = outgoing.get(s.id as string) ?? [];
    const always: StateTransition[] = [];
    const after = new Map<string, { delay: number | string; list: StateTransition[] }>();
    const on = new Map<string, StateTransition[]>();
    for (const t of list) {
      const sig = parseTransitionLabel(t.label);
      if (sig.delay !== undefined) {
        const key = String(sig.delay);
        const slot = after.get(key) ?? { delay: sig.delay, list: [] };
        slot.list.push(t);
        after.set(key, slot);
      } else if (sig.event === undefined) always.push(t);
      else {
        const slot = on.get(sig.event) ?? [];
        slot.push(t);
        on.set(sig.event, slot);
      }
    }
    const group = (ts: readonly StateTransition[]): Js =>
      ts.length === 1 ? transitionJs(s, ts[0]!) : arr(ts.map((t) => transitionJs(s, t)));
    const entries: (readonly [string, Js])[] = [];
    if (always.length > 0) entries.push(["always", group(always)]);
    if (after.size > 0) entries.push(["after", obj([...after.values()].map((slot) => [String(slot.delay), group(slot.list)] as const))]);
    if (on.size > 0) entries.push(["on", obj([...on.entries()].map(([event, ts]) => [event, group(ts)] as const))]);
    return entries;
  }

  // ---- states -----------------------------------------------------------

  /** `initial` + `states` for one container region. */
  function scopeEntries(parent: StateId | undefined, region: number): (readonly [string, Js])[] {
    const members = membersIn(parent, region);
    const start = members.find((m) => m.role === "start");
    const entries: (readonly [string, Js])[] = [];
    if (start !== undefined) {
      const target = initialOf.get(start.id as string);
      if (target === undefined) warnings.push(`the \`[*]\` in \`${parent ?? "the machine"}\` points nowhere, so no \`initial\` was written`);
      else entries.push(["initial", val(keyOf(target))]);
    }
    const real = members.filter((m) => m.role !== "start");
    if (real.length > 0) entries.push(["states", obj(real.map((m) => [keyOf(m.id), stateJs(m)] as const))]);
    return entries;
  }

  function stateJs(s: StateNode): Js {
    const xs = s.xstate;
    const entries: (readonly [string, Js])[] = [];
    if (needsId.has(s.id as string)) entries.push(["id", val(xidOf(s))]);

    const composite = isComposite(s.id);
    const parallel = composite ? isParallel(s) : s.xstate?.parallel === true;
    if (s.role === "end" || xs?.final === true) entries.push(["type", val("final")]);
    else if (xs?.history !== undefined) {
      entries.push(["type", val("history")], ["history", val(xs.history)]);
      if (xs.historyTarget !== undefined) entries.push(["target", val(xs.historyTarget)]);
    } else if (parallel) entries.push(["type", val("parallel")]);

    if (s.role === "normal" && s.label !== (s.id as string) && s.label !== "") entries.push(["description", val(s.label)]);
    else if (xs?.description !== undefined) entries.push(["description", val(xs.description)]);

    if (xs?.entry !== undefined) entries.push(["entry", actionsJs(xs.entry)]);
    if (xs?.exit !== undefined) entries.push(["exit", actionsJs(xs.exit)]);
    if (xs?.invoke !== undefined) entries.push(["invoke", xs.invoke.length === 1 ? val(xs.invoke[0]!) : arr(xs.invoke.map(val))]);
    if (xs?.tags !== undefined) entries.push(["tags", xs.tags.length === 1 ? val(xs.tags[0]!) : val([...xs.tags])]);
    if (xs?.meta !== undefined) entries.push(["meta", val(xs.meta)]);
    if (xs?.output !== undefined) entries.push(["output", val(xs.output)]);

    entries.push(...transitionEntries(s));
    if (xs?.onDone !== undefined) entries.push(["onDone", xs.onDone.length === 1 ? val(xs.onDone[0]!) : arr(xs.onDone.map(val))]);

    if (composite) {
      if (parallel) entries.push(["states", obj(regionEntries(s))]);
      else entries.push(...scopeEntries(s.id, 0));
    }
    return obj(entries);
  }

  /** XState's regions ARE states; mermaid's regions are bands that may hold
   * several. A band with one resident becomes that state; anything else gets
   * a synthesized wrapper, and the user is told. */
  function regionEntries(s: StateNode): (readonly [string, Js])[] {
    const out: (readonly [string, Js])[] = [];
    const taken = new Set<string>();
    for (let r = 0; r < regionCount(s.id); r++) {
      const members = membersIn(s.id, r);
      const real = members.filter((m) => m.role !== "start");
      const start = members.find((m) => m.role === "start");
      if (real.length === 1 && start === undefined) {
        const only = real[0]!;
        taken.add(keyOf(only.id));
        out.push([keyOf(only.id), stateJs(only)] as const);
        continue;
      }
      const siblingKeys = new Set(ir.states.filter((x) => x.parent === s.id).map((x) => keyOf(x.id)));
      let key = `region${r + 1}`;
      for (let n = 2; taken.has(key) || siblingKeys.has(key); n++) key = `region${r + 1}_${n}`;
      taken.add(key);
      warnings.push(
        `region ${r + 1} of \`${s.id}\` holds ${real.length} states; XState needs one state per region, so they were wrapped in \`${key}\``,
      );
      out.push([key, obj(scopeEntries(s.id, r))] as const);
    }
    return out;
  }

  // ---- the machine ------------------------------------------------------
  const m = ir.xstate;
  const rootEntries: (readonly [string, Js])[] = [];
  if (m?.id !== undefined) rootEntries.push(["id", val(m.id)]);
  if (m?.types !== undefined) rootEntries.push(["types", val(m.types)]);
  if (m?.description !== undefined) rootEntries.push(["description", val(m.description)]);
  if (m?.context !== undefined) rootEntries.push(["context", raw(m.context)]);
  if (m?.entry !== undefined) rootEntries.push(["entry", actionsJs(m.entry)]);
  if (m?.exit !== undefined) rootEntries.push(["exit", actionsJs(m.exit)]);
  if (m?.invoke !== undefined) rootEntries.push(["invoke", m.invoke.length === 1 ? val(m.invoke[0]!) : arr(m.invoke.map(val))]);
  if (m?.tags !== undefined) rootEntries.push(["tags", m.tags.length === 1 ? val(m.tags[0]!) : val([...m.tags])]);
  if (m?.meta !== undefined) rootEntries.push(["meta", val(m.meta)]);
  if (m?.output !== undefined) rootEntries.push(["output", val(m.output)]);
  if (m?.onDone !== undefined) rootEntries.push(["onDone", m.onDone.length === 1 ? val(m.onDone[0]!) : arr(m.onDone.map(val))]);
  rootEntries.push(...scopeEntries(undefined, 0));

  if (ir.notes.length > 0) {
    warnings.push(`${ir.notes.length} note(s) are a mermaid-only feature and are not part of the machine`);
  }

  const config = render(obj(rootEntries), "");
  const setupText = m?.setup;
  const body =
    setupText === undefined
      ? `export const machine = createMachine(${config});\n`
      : `export const machine = setup(${setupText.split("\n").join("\n")}).createMachine(${config});\n`;
  const mentioned = HELPERS.filter((h) => new RegExp(`\\b${h}\\s*\\(`).test(`${setupText ?? ""}\n${m?.context ?? ""}`));
  const imports = [setupText === undefined ? "createMachine" : "setup", ...mentioned];
  return { code: `import { ${imports.join(", ")} } from "xstate";\n\n${body}`, warnings };
}
