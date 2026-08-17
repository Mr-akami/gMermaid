import type { BranchId, FragmentId, LifelineId, MessageId, NoteId } from "./ids";
import type {
  Fragment,
  FragmentKind,
  Lifeline,
  Message,
  MessageArrowType,
  Note,
  NotePosition,
  SequenceEvent,
  SequenceIR,
} from "./sequence";
import { findEventPosition, findSequenceBranch, findSequenceEvent, getContainerEvents } from "./sequenceQuery";

// Same contract as flowchart actions: intent-carrying, immutable,
// identity-preserving on no-ops. Fragment membership is structural, so
// "moving a fragment border" arrives here as moveEventIntoBranch /
// moveEventOutOfFragment, never as coordinates.
export type SequenceAction =
  | { type: "addLifeline"; lifeline: Lifeline }
  | { type: "updateLifeline"; id: LifelineId; name?: string; isActor?: boolean }
  | { type: "removeLifeline"; id: LifelineId }
  | { type: "moveLifeline"; id: LifelineId; index: number }
  | { type: "addMessage"; message: Message; afterEventId?: MessageId | FragmentId }
  | { type: "addEventAt"; event: Message | Note; container: EventContainer; index: number }
  | { type: "updateMessage"; id: MessageId; label?: string; arrow?: MessageArrowType }
  | { type: "updateNote"; id: NoteId; text?: string; position?: NotePosition }
  | { type: "removeEvent"; id: MessageId | FragmentId | NoteId }
  | { type: "updateFragment"; id: FragmentId; fragmentKind?: FragmentKind }
  | { type: "updateBranch"; id: BranchId; condition: string }
  | { type: "addBranch"; fragmentId: FragmentId; branchId: BranchId; condition: string }
  | { type: "moveEventTo"; id: MessageId | FragmentId | NoteId; container: EventContainer; index: number }
  | {
      type: "wrapInFragment";
      fragmentId: FragmentId;
      branchId: BranchId;
      fragmentKind: FragmentKind;
      condition: string;
      eventIds: readonly (MessageId | FragmentId | NoteId)[];
    };

/** Where an event lives: the top level, or inside a fragment branch. */
export type EventContainer = { kind: "root" } | { kind: "branch"; branchId: BranchId };

type Events = readonly SequenceEvent[];

/** Map events recursively; mapper returns null to delete, array to splice. */
function mapEvents(
  events: Events,
  fn: (e: SequenceEvent) => SequenceEvent | readonly SequenceEvent[] | null,
): Events {
  let changed = false;
  const out: SequenceEvent[] = [];
  for (const e of events) {
    const mapped = fn(e);
    if (mapped === null) {
      changed = true;
      continue;
    }
    if (Array.isArray(mapped)) {
      if (!(mapped.length === 1 && mapped[0] === e)) changed = true;
      out.push(...(mapped as SequenceEvent[]));
      continue;
    }
    let ev = mapped as SequenceEvent;
    if (ev.kind === "fragment") {
      const frag = ev;
      const branches = frag.branches.map((b) => {
        const inner = mapEvents(b.events, fn);
        return inner === b.events ? b : { ...b, events: inner };
      });
      if (branches.some((b, i) => b !== frag.branches[i])) {
        ev = { ...frag, branches };
      }
    }
    if (ev !== e) changed = true;
    out.push(ev);
  }
  return changed ? out : events;
}

/** True if any message or note (at any nesting depth) references this
 * lifeline. Exported so the UI can disable "delete lifeline" instead of it
 * silently no-opping. */
export function messagesTouching(events: Events, lifeline: LifelineId): boolean {
  return events.some((e) => {
    if (e.kind === "message") return e.from === lifeline || e.to === lifeline;
    if (e.kind === "note") return e.lifelines.includes(lifeline);
    return e.branches.some((b) => messagesTouching(b.events, lifeline));
  });
}

export function applySequenceAction(ir: SequenceIR, action: SequenceAction): SequenceIR {
  switch (action.type) {
    case "addLifeline":
      if (ir.lifelines.some((l) => l.id === action.lifeline.id)) return ir;
      return { ...ir, lifelines: [...ir.lifelines, action.lifeline] };

    case "updateLifeline": {
      const l = ir.lifelines.find((x) => x.id === action.id);
      if (!l) return ir;
      const rawName = action.name ?? l.name;
      const name = rawName === "" ? (l.id as string) : rawName; // empty names break the mermaid syntax
      const isActor = action.isActor ?? l.isActor;
      if (name === l.name && isActor === l.isActor) return ir;
      return {
        ...ir,
        lifelines: ir.lifelines.map((x) => (x.id === action.id ? { ...x, name, isActor } : x)),
      };
    }

    case "removeLifeline": {
      if (!ir.lifelines.some((l) => l.id === action.id)) return ir;
      if (messagesTouching(ir.events, action.id)) return ir; // remove its messages first
      return { ...ir, lifelines: ir.lifelines.filter((l) => l.id !== action.id) };
    }

    case "moveLifeline": {
      const from = ir.lifelines.findIndex((l) => l.id === action.id);
      if (from < 0) return ir;
      const to = Math.max(0, Math.min(action.index, ir.lifelines.length - 1));
      if (from === to) return ir;
      const lifelines = [...ir.lifelines];
      const [l] = lifelines.splice(from, 1);
      lifelines.splice(to, 0, l!);
      return { ...ir, lifelines };
    }

    case "addEventAt": {
      const ev = action.event;
      if (findSequenceEvent(ir, ev.id)) return ir;
      const known = (id: LifelineId) => ir.lifelines.some((l) => l.id === id);
      if (ev.kind === "message" && (!known(ev.from) || !known(ev.to))) return ir;
      if (ev.kind === "note" && (ev.lifelines.length === 0 || !ev.lifelines.every(known))) return ir;
      const insert = (events: Events): Events => {
        const i = Math.max(0, Math.min(action.index, events.length));
        return [...events.slice(0, i), ev, ...events.slice(i)];
      };
      if (action.container.kind === "root") return { ...ir, events: insert(ir.events) };
      const branchId = action.container.branchId;
      const next = mapEvents(ir.events, (e) => {
        if (e.kind !== "fragment" || !e.branches.some((b) => b.id === branchId)) return e;
        return { ...e, branches: e.branches.map((b) => (b.id === branchId ? { ...b, events: insert(b.events) } : b)) };
      });
      return next === ir.events ? ir : { ...ir, events: next };
    }

    case "updateNote": {
      const next = mapEvents(ir.events, (e) => {
        if (e.kind !== "note" || e.id !== action.id) return e;
        const text = action.text ?? e.text;
        const position = action.position ?? e.position;
        if (text === e.text && position === e.position) return e;
        return { ...e, text, position };
      });
      return next === ir.events ? ir : { ...ir, events: next };
    }

    case "addMessage": {
      const { message } = action;
      // "add rejects existing ids" holds across every add action, so an id
      // collision degrades to a visible no-op instead of silent corruption
      if (findSequenceEvent(ir, message.id)) return ir;
      const known = (id: LifelineId) => ir.lifelines.some((l) => l.id === id);
      if (!known(message.from) || !known(message.to)) return ir;
      if (action.afterEventId === undefined) {
        return { ...ir, events: [...ir.events, message] };
      }
      const next = mapEvents(ir.events, (e) => (e.id === action.afterEventId ? [e, message] : e));
      return next === ir.events ? ir : { ...ir, events: next };
    }

    case "updateMessage": {
      const next = mapEvents(ir.events, (e) => {
        if (e.kind !== "message" || e.id !== action.id) return e;
        const label = action.label ?? e.label;
        const arrow = action.arrow ?? e.arrow;
        if (label === e.label && arrow === e.arrow) return e;
        return { ...e, label, arrow };
      });
      return next === ir.events ? ir : { ...ir, events: next };
    }

    case "removeEvent": {
      const next = mapEvents(ir.events, (e) => (e.id === action.id ? null : e));
      return next === ir.events ? ir : { ...ir, events: next };
    }

    case "updateFragment": {
      const next = mapEvents(ir.events, (e) => {
        if (e.kind !== "fragment" || e.id !== action.id) return e;
        const fragmentKind = action.fragmentKind ?? e.fragmentKind;
        if (fragmentKind === e.fragmentKind) return e;
        return { ...e, fragmentKind };
      });
      return next === ir.events ? ir : { ...ir, events: next };
    }

    case "updateBranch": {
      const next = mapEvents(ir.events, (e) => {
        if (e.kind !== "fragment") return e;
        const branches = e.branches.map((b) =>
          b.id === action.id && b.condition !== action.condition
            ? { ...b, condition: action.condition }
            : b,
        );
        return branches.some((b, i) => b !== e.branches[i]) ? { ...e, branches } : e;
      });
      return next === ir.events ? ir : { ...ir, events: next };
    }

    case "addBranch": {
      if (findSequenceBranch(ir, action.branchId)) return ir;
      const next = mapEvents(ir.events, (e) => {
        if (e.kind !== "fragment" || e.id !== action.fragmentId) return e;
        return {
          ...e,
          branches: [...e.branches, { id: action.branchId, condition: action.condition, events: [] }],
        };
      });
      return next === ir.events ? ir : { ...ir, events: next };
    }

    case "moveEventTo": {
      // Dragging a message row or a fragment border arrives here: membership
      // is structural, so a "resize" is just events changing container.
      let moved: SequenceEvent | undefined;
      const findTarget = (events: Events): void => {
        for (const e of events) {
          if (e.id === action.id) moved = e;
          else if (e.kind === "fragment") for (const b of e.branches) findTarget(b.events);
        }
      };
      findTarget(ir.events);
      if (!moved) return ir;
      // a fragment must not be moved into itself or a descendant
      if (moved.kind === "fragment" && action.container.kind === "branch") {
        const branchId = action.container.branchId;
        const containsBranch = (f: Fragment): boolean =>
          f.branches.some(
            (b) => b.id === branchId || b.events.some((e) => e.kind === "fragment" && containsBranch(e)),
          );
        if (containsBranch(moved)) return ir;
      }
      if (action.container.kind === "branch") {
        const target = action.container.branchId;
        let exists = false;
        const check = (events: Events): void => {
          for (const e of events) {
            if (e.kind !== "fragment") continue;
            if (e.branches.some((b) => b.id === target)) exists = true;
            for (const b of e.branches) check(b.events);
          }
        };
        check(ir.events);
        if (!exists) return ir;
      }

      const removed = mapEvents(ir.events, (e) => (e.id === action.id ? null : e));
      const insert = (events: Events): Events => {
        const i = Math.max(0, Math.min(action.index, events.length));
        return [...events.slice(0, i), moved!, ...events.slice(i)];
      };
      if (action.container.kind === "root") {
        return { ...ir, events: insert(removed) };
      }
      const branchId = action.container.branchId;
      const placed = mapEvents(removed, (e) => {
        if (e.kind !== "fragment" || !e.branches.some((b) => b.id === branchId)) return e;
        return {
          ...e,
          branches: e.branches.map((b) => (b.id === branchId ? { ...b, events: insert(b.events) } : b)),
        };
      });
      return { ...ir, events: placed };
    }

    case "wrapInFragment": {
      // Wrap a contiguous run of events (in whatever container they live in)
      // into a new fragment.
      if (findSequenceEvent(ir, action.fragmentId) || findSequenceBranch(ir, action.branchId)) return ir;
      const firstId = action.eventIds[0];
      if (firstId === undefined) return ir;
      const pos = findEventPosition(ir, firstId);
      if (!pos) return ir;
      const list = getContainerEvents(ir, pos.container);
      const idx = list.findIndex((e) => action.eventIds.includes(e.id));
      if (idx < 0) return ir;
      const run: SequenceEvent[] = [];
      let i = idx;
      while (i < list.length && action.eventIds.includes(list[i]!.id)) {
        run.push(list[i]!);
        i += 1;
      }
      if (run.length !== action.eventIds.length) return ir; // not contiguous in one container
      const fragment: Fragment = {
        kind: "fragment",
        id: action.fragmentId,
        fragmentKind: action.fragmentKind,
        branches: [{ id: action.branchId, condition: action.condition, events: run }],
      };
      const replaced = [...list.slice(0, idx), fragment, ...list.slice(i)];
      if (pos.container.kind === "root") return { ...ir, events: replaced };
      const branchId = pos.container.branchId;
      const next = mapEvents(ir.events, (e) => {
        if (e.kind !== "fragment" || !e.branches.some((b) => b.id === branchId)) return e;
        return { ...e, branches: e.branches.map((b) => (b.id === branchId ? { ...b, events: replaced } : b)) };
      });
      return next === ir.events ? ir : { ...ir, events: next };
    }
  }
}
