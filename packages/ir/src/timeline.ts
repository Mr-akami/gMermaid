import type { EventId, PeriodId, SectionId } from "./ids";

// Timeline diagrams: an optional title, then periods (`2002 : LinkedIn`) in
// left-to-right order, each carrying zero or more events; `section` groups
// consecutive periods. Mermaid has no ids for any of these — periods are
// identified by position — so the IR mints its own (`period-N` on import).
// Text is raw mermaid text: no entity escaping, only `<br>` ↔ newline.

export interface TimelineEvent {
  readonly id: EventId;
  /** Never empty and never contains `:` (mermaid's event separator). */
  readonly text: string;
}

export interface TimelinePeriod {
  readonly id: PeriodId;
  /** The text before the first `:`; same character rules as event text. */
  readonly label: string;
  readonly events: readonly TimelineEvent[];
}

export interface TimelineSection {
  readonly id: SectionId;
  /** Empty = the implicit group of periods written before any `section`.
   * Only the FIRST section may be unnamed — a later one would merge into its
   * predecessor on re-import. */
  readonly name: string;
  readonly periods: readonly TimelinePeriod[];
}

export interface TimelineIR {
  readonly kind: "timeline";
  readonly title?: string;
  readonly sections: readonly TimelineSection[];
}

export function emptyTimeline(): TimelineIR {
  return { kind: "timeline", sections: [] };
}

/** The section a period lives in, if any. */
export function sectionOfPeriod(ir: TimelineIR, id: PeriodId): TimelineSection | undefined {
  return ir.sections.find((s) => s.periods.some((p) => p.id === id));
}

/** The period an event lives in, if any. */
export function periodOfEvent(ir: TimelineIR, id: EventId): TimelinePeriod | undefined {
  for (const s of ir.sections) {
    const p = s.periods.find((x) => x.events.some((e) => e.id === id));
    if (p) return p;
  }
  return undefined;
}
