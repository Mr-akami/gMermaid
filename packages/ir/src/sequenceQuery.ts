import type { Branch, Fragment, Message, Note, SequenceEvent, SequenceIR } from "./sequence";

export function findSequenceEvent(ir: SequenceIR, id: string): Message | Fragment | Note | undefined {
  const search = (events: readonly SequenceEvent[]): Message | Fragment | Note | undefined => {
    for (const e of events) {
      if (e.id === id) return e;
      if (e.kind === "fragment") {
        for (const b of e.branches) {
          const hit = search(b.events);
          if (hit) return hit;
        }
      }
    }
    return undefined;
  };
  return search(ir.events);
}

import type { EventContainer } from "./sequenceActions";

/** Locate which container holds an event, and at which index. */
export function findEventPosition(
  ir: SequenceIR,
  id: string,
): { container: EventContainer; index: number } | undefined {
  const search = (
    events: readonly SequenceEvent[],
    container: EventContainer,
  ): { container: EventContainer; index: number } | undefined => {
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      if (e.id === id) return { container, index: i };
      if (e.kind === "fragment") {
        for (const b of e.branches) {
          const hit = search(b.events, { kind: "branch", branchId: b.id });
          if (hit) return hit;
        }
      }
    }
    return undefined;
  };
  return search(ir.events, { kind: "root" });
}

/** The event list of a container (root or a fragment branch). */
export function getContainerEvents(ir: SequenceIR, container: EventContainer): readonly SequenceEvent[] {
  if (container.kind === "root") return ir.events;
  const hit = findSequenceBranch(ir, container.branchId);
  return hit ? hit.branch.events : [];
}

export function findSequenceBranch(
  ir: SequenceIR,
  id: string,
): { fragment: Fragment; branch: Branch } | undefined {
  const search = (events: readonly SequenceEvent[]): { fragment: Fragment; branch: Branch } | undefined => {
    for (const e of events) {
      if (e.kind !== "fragment") continue;
      for (const b of e.branches) {
        if (b.id === id) return { fragment: e, branch: b };
        const hit = search(b.events);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  return search(ir.events);
}
