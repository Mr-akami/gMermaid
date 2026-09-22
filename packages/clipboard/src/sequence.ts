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

/**
 * `create X` only makes sense in front of a message that reaches X, and
 * `destroy X` only after one that touches it — mermaid enforces both, so a
 * slice that lifted the message away has to drop the lifecycle event too.
 */
function dropOrphanLifecycles(events: readonly SequenceEvent[]): readonly SequenceEvent[] {
  const reaches = (from: number, to: number, want: LifelineId, asTarget: boolean): boolean => {
    for (let i = from; i < to; i++) {
      const e = events[i]!;
      if (e.kind !== "message") continue;
      if (asTarget ? e.to === want : e.from === want || e.to === want) return true;
    }
    return false;
  };
  return events.filter((e, i) => {
    if (e.kind === "create") return reaches(i + 1, events.length, e.lifeline, true);
    if (e.kind === "destroy") return reaches(0, i, e.lifeline, false);
    return true;
  });
}

/**
 * Re-balance activation over a slice. `deactivate X` with no matching
 * `activate X` is a mermaid error, and a `->>-` whose `->>+` stayed behind
 * is the same error in suffix form; an activation that is never closed is
 * dropped for symmetry, so the copy neither leaks nor under-runs. Applied
 * only to the flattened top level: a fragment travels whole, so whatever is
 * inside it was already balanced by the source.
 */
function rebalanceActivation(events: readonly SequenceEvent[]): readonly SequenceEvent[] {
  const open = new Map<string, number[]>();
  const stackOf = (l: string): number[] => {
    const s = open.get(l) ?? [];
    open.set(l, s);
    return s;
  };
  /** standalone `activate`/`deactivate` events to remove entirely */
  const drop = new Set<number>();
  /** messages that keep their arrow but lose the `+`/`-` suffix */
  const strip = new Set<number>();

  events.forEach((e, i) => {
    if (e.kind === "activation") {
      if (e.on) stackOf(e.lifeline).push(i);
      else if (stackOf(e.lifeline).pop() === undefined) drop.add(i);
      return;
    }
    if (e.kind !== "message" || e.activate === undefined) return;
    if (e.activate === "start") stackOf(e.to).push(i);
    else if (stackOf(e.from).pop() === undefined) strip.add(i);
  });

  // whatever is still on a stack never closes, so the opener goes too
  for (const stack of open.values()) {
    for (const i of stack) (events[i]!.kind === "activation" ? drop : strip).add(i);
  }

  return events.flatMap((e, i) => {
    if (drop.has(i)) return [];
    if (strip.has(i) && e.kind === "message") return [omitUndefined({ ...e, activate: undefined })];
    return [e];
  });
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

  const events = rebalanceActivation(dropOrphanLifecycles(take(ir.events)));

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
