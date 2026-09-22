import type { Box, Branch, Fragment, LifelineId, Message, SequenceEvent, SequenceIR } from "@gmermaid/ir";
import { findSequenceBranch, newId, normalizeFragment, normalizeSequenceNote, omitUndefined } from "@gmermaid/ir";
import type { KindClipboard, MergeResult } from "./kind";
import { uniqueName } from "./kind";

/** Every lifeline an event (and everything nested inside it) names. */
function lifelinesOf(e: SequenceEvent, out: Set<string>): void {
  switch (e.kind) {
    case "message":
      out.add(e.from);
      out.add(e.to);
      return;
    case "note":
      for (const l of e.lifelines) out.add(l);
      return;
    case "fragment":
      for (const b of e.branches) for (const x of b.events) lifelinesOf(x, out);
      return;
    default:
      out.add(e.lifeline);
  }
}

/** Every event of a slice in document order, fragment contents included —
 * mermaid reads a fragment's body in line, so the two mermaid rules below
 * have to be checked across the whole tree, not per container. */
function flatten(events: readonly SequenceEvent[], out: SequenceEvent[] = []): SequenceEvent[] {
  for (const e of events) {
    out.push(e);
    if (e.kind === "fragment") for (const b of e.branches) flatten(b.events, out);
  }
  return out;
}

/** Rebuild the tree without `drop`, and with `strip`'s messages demoted to a
 * plain arrow. Identity-keyed, so it pairs with `flatten`. */
function prune(
  events: readonly SequenceEvent[],
  drop: ReadonlySet<SequenceEvent>,
  strip: ReadonlySet<SequenceEvent>,
): SequenceEvent[] {
  return events.flatMap<SequenceEvent>((e) => {
    if (e.kind === "fragment") {
      return [{ ...e, branches: e.branches.map((b) => ({ ...b, events: prune(b.events, drop, strip) })) }];
    }
    if (drop.has(e)) return [];
    if (strip.has(e) && e.kind === "message") return [omitUndefined({ ...e, activate: undefined })];
    return [e];
  });
}

/**
 * mermaid reads `create X` and `destroy X` as a prefix on the NEXT message:
 * a create wants that message to reach X, a destroy wants it to touch X, and
 * either way mermaid refuses the statement when it does not. A slice that
 * lifted the message away therefore has to drop the lifecycle event too —
 * the lifeline then simply goes back to being declared up front.
 */
function orphanLifecycles(events: readonly SequenceEvent[]): Set<SequenceEvent> {
  const flat = flatten(events);
  const doomed = new Set<SequenceEvent>();
  for (let i = 0; i < flat.length; i++) {
    const e = flat[i]!;
    if (e.kind !== "create" && e.kind !== "destroy") continue;
    const next = flat.slice(i + 1).find((x) => x.kind === "message");
    const justified =
      next !== undefined && (e.kind === "create" ? next.to === e.lifeline : next.from === e.lifeline || next.to === e.lifeline);
    if (!justified) doomed.add(e);
  }
  return doomed;
}

/**
 * `deactivate X` with no matching `activate X` is a mermaid error, and a
 * `->>-` whose `->>+` stayed behind is the same error in suffix form; an
 * activation that is never closed is dropped for symmetry, so a slice
 * neither leaks nor under-runs.
 */
function unbalancedActivation(events: readonly SequenceEvent[]): {
  readonly drop: Set<SequenceEvent>;
  readonly strip: Set<SequenceEvent>;
} {
  const open = new Map<string, SequenceEvent[]>();
  const stackOf = (l: string): SequenceEvent[] => {
    const s = open.get(l) ?? [];
    open.set(l, s);
    return s;
  };
  /** standalone `activate`/`deactivate` events to remove entirely */
  const drop = new Set<SequenceEvent>();
  /** messages that keep their arrow but lose the `+`/`-` suffix */
  const strip = new Set<SequenceEvent>();

  for (const e of flatten(events)) {
    if (e.kind === "activation") {
      if (e.on) stackOf(e.lifeline).push(e);
      else if (stackOf(e.lifeline).pop() === undefined) drop.add(e);
      continue;
    }
    if (e.kind !== "message" || e.activate === undefined) continue;
    if (e.activate === "start") stackOf(e.to).push(e);
    else if (stackOf(e.from).pop() === undefined) strip.add(e);
  }

  // whatever is still on a stack never closes, so the opener goes too
  for (const stack of open.values()) for (const e of stack) (e.kind === "activation" ? drop : strip).add(e);
  return { drop, strip };
}

/** Closure: a branch resolves to its fragment, a fragment travels whole, an
 * event whose fragment stayed behind is lifted to the top level, and every
 * lifeline a surviving event names comes along. See `clipboard.ts`. */
function slice(ir: SequenceIR, ids: ReadonlySet<string>): SequenceIR | undefined {
  // a branch is half an `alt`: it resolves to the fragment that owns it
  const wanted = new Set<string>(ids);
  for (const id of ids) {
    const hit = findSequenceBranch(ir, id);
    if (hit) wanted.add(hit.fragment.id);
  }

  const take = (events: readonly SequenceEvent[]): SequenceEvent[] =>
    events.flatMap((e) => {
      if (e.kind === "fragment") {
        if (wanted.has(e.id)) return [e];
        return e.branches.flatMap((b) => take(b.events));
      }
      return wanted.has(e.id) ? [e] : [];
    });

  const taken = take(ir.events);
  const withoutOrphans = prune(taken, orphanLifecycles(taken), new Set());
  const { drop, strip } = unbalancedActivation(withoutOrphans);
  const events = prune(withoutOrphans, drop, strip);

  const lifelines = new Set<string>(ir.lifelines.filter((l) => ids.has(l.id)).map((l) => l.id));
  for (const e of events) lifelinesOf(e, lifelines);
  for (const b of ir.boxes) if (ids.has(b.id)) for (const l of b.lifelines) lifelines.add(l);

  if (lifelines.size === 0) return undefined;

  const boxes: Box[] = ir.boxes
    .map((b) => ({ ...b, lifelines: b.lifelines.filter((l) => lifelines.has(l)) }))
    .filter((b) => b.lifelines.length > 0);

  return omitUndefined({
    kind: "sequence" as const,
    lifelines: ir.lifelines.filter((l) => lifelines.has(l.id)),
    boxes,
    events,
    autonumber: ir.autonumber,
  });
}

function merge(ir: SequenceIR, inc: SequenceIR): MergeResult<SequenceIR> {
  if (inc.lifelines.length === 0) return { reason: "the clipboard holds an empty sequence diagram" };

  // mermaid addresses lifelines by name, so names are the identity here
  const names = new Set(ir.lifelines.map((l) => l.name));
  const map = new Map<string, LifelineId>();
  const lifelines = inc.lifelines.map((l) => {
    const id = newId("lifeline");
    map.set(l.id, id);
    return { ...l, id, name: uniqueName(l.name, names) };
  });

  const added: string[] = lifelines.map((l) => l.id as string);

  const rebuild = (events: readonly SequenceEvent[]): SequenceEvent[] =>
    events.flatMap<SequenceEvent>((e) => {
      switch (e.kind) {
        case "message": {
          const from = map.get(e.from);
          const to = map.get(e.to);
          if (from === undefined || to === undefined) return [];
          const id = newId("message");
          added.push(id);
          return [{ ...e, id, from, to } satisfies Message];
        }
        case "note": {
          const ls = e.lifelines.flatMap((l) => {
            const next = map.get(l);
            return next === undefined ? [] : [next];
          });
          if (ls.length === 0) return [];
          const id = newId("note");
          added.push(id);
          return [normalizeSequenceNote({ ...e, id, lifelines: ls })];
        }
        case "fragment": {
          const branches: Branch[] = e.branches.map((b) => ({ ...b, id: newId("branch"), events: rebuild(b.events) }));
          const id = newId("fragment");
          added.push(id);
          return [normalizeFragment({ ...e, id, branches } satisfies Fragment)];
        }
        case "activation": {
          const lifeline = map.get(e.lifeline);
          if (lifeline === undefined) return [];
          const id = newId("activation");
          added.push(id);
          return [{ ...e, id, lifeline }];
        }
        default: {
          const lifeline = map.get(e.lifeline);
          if (lifeline === undefined) return [];
          const id = newId("lifecycle");
          added.push(id);
          return [{ ...e, id, lifeline }];
        }
      }
    });

  const events = rebuild(inc.events);
  const boxes: Box[] = inc.boxes.flatMap((b) => {
    const ls = b.lifelines.flatMap((l) => {
      const next = map.get(l);
      return next === undefined ? [] : [next];
    });
    return ls.length === 0 ? [] : [{ ...b, id: newId("box"), lifelines: ls }];
  });

  return {
    // `autonumber` is the target's: a paste must not renumber the diagram
    ir: { ...ir, lifelines: [...ir.lifelines, ...lifelines], boxes: [...ir.boxes, ...boxes], events: [...ir.events, ...events] },
    added,
  };
}

export const sequenceClipboard: KindClipboard<SequenceIR> = { slice, merge };
