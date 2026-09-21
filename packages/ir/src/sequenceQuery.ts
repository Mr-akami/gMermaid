import type { LifelineId } from "./ids";
import type { Box, Branch, Fragment, Message, SequenceEvent, SequenceIR } from "./sequence";

export function findSequenceEvent(ir: SequenceIR, id: string): SequenceEvent | undefined {
  const search = (events: readonly SequenceEvent[]): SequenceEvent | undefined => {
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

/** Every message touching a lifeline, in document order (depth-first). */
export function messagesOf(ir: SequenceIR, lifeline: LifelineId): Message[] {
  const out: Message[] = [];
  const walk = (events: readonly SequenceEvent[]): void => {
    for (const e of events) {
      if (e.kind === "message" && (e.from === lifeline || e.to === lifeline)) out.push(e);
      else if (e.kind === "fragment") for (const b of e.branches) walk(b.events);
    }
  };
  walk(ir.events);
  return out;
}

/** True if a create/destroy event for the lifeline exists anywhere. */
export function hasLifecycle(ir: SequenceIR, lifeline: LifelineId, which: "create" | "destroy"): boolean {
  const walk = (events: readonly SequenceEvent[]): boolean =>
    events.some(
      (e) => (e.kind === which && e.lifeline === lifeline) || (e.kind === "fragment" && e.branches.some((b) => walk(b.events))),
    );
  return walk(ir.events);
}

export function boxOf(ir: SequenceIR, lifeline: LifelineId): Box | undefined {
  return ir.boxes.find((b) => b.lifelines.includes(lifeline));
}
