import type { EventId, PeriodId, SectionId } from "./ids";
import { periodOfEvent, sectionOfPeriod, type TimelineEvent, type TimelineIR, type TimelinePeriod, type TimelineSection } from "./timeline";
import { omitUndefined } from "./omitUndefined";

// Same contract as the other diagram actions: intent-carrying, immutable,
// identity-preserving on no-ops.

/** Why `text` cannot be a period label / event text / section name, or
 * undefined when it can. `:` separates period from events in mermaid text
 * (and crashes mermaid's parser inside a section name), so it has no escape;
 * an empty label would emit `: event`, which mermaid rejects. Shared by the
 * reducer (reject) and the UI (show the reason). */
export function timelineTextRejection(text: string): string | undefined {
  if (text.trim() === "") return "text cannot be empty";
  if (text.includes(":")) return "`:` is not allowed (mermaid separator)";
  return undefined;
}

export type TimelineAction =
  | { type: "setTitle"; title: string }
  | { type: "addSection"; section: TimelineSection }
  | { type: "updateSection"; id: SectionId; name: string }
  | { type: "removeSection"; id: SectionId }
  | { type: "addPeriod"; sectionId: SectionId; period: TimelinePeriod }
  | { type: "updatePeriod"; id: PeriodId; label: string }
  /** Swap with the neighbour within its section; out of range = no-op. */
  | { type: "movePeriod"; id: PeriodId; delta: -1 | 1 }
  | { type: "removePeriod"; id: PeriodId }
  | { type: "addEvent"; periodId: PeriodId; event: TimelineEvent }
  | { type: "updateEvent"; id: EventId; text: string }
  | { type: "moveEvent"; id: EventId; delta: -1 | 1 }
  | { type: "removeEvent"; id: EventId };

function swap<T>(xs: readonly T[], i: number, delta: -1 | 1): readonly T[] | undefined {
  const j = i + delta;
  if (i < 0 || j < 0 || j >= xs.length) return undefined;
  const out = [...xs];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

const mapSections = (ir: TimelineIR, f: (s: TimelineSection) => TimelineSection): TimelineIR => ({
  ...ir,
  sections: ir.sections.map(f),
});
const mapPeriods = (ir: TimelineIR, f: (p: TimelinePeriod) => TimelinePeriod): TimelineIR =>
  mapSections(ir, (s) => ({ ...s, periods: s.periods.map(f) }));

export function applyTimelineAction(ir: TimelineIR, action: TimelineAction): TimelineIR {
  switch (action.type) {
    case "setTitle": {
      const title = action.title.trim() === "" ? undefined : action.title;
      if (title === ir.title) return ir;
      return omitUndefined({ ...ir, title });
    }

    case "addSection": {
      const s = action.section;
      if (ir.sections.some((x) => x.id === s.id)) return ir;
      // the unnamed section is positional: only ever first
      if (s.name === "" ? ir.sections.length > 0 : timelineTextRejection(s.name) !== undefined) return ir;
      return { ...ir, sections: [...ir.sections, s] };
    }

    case "updateSection": {
      const s = ir.sections.find((x) => x.id === action.id);
      if (!s || s.name === action.name) return ir;
      if (timelineTextRejection(action.name) !== undefined) return ir;
      return mapSections(ir, (x) => (x.id === action.id ? { ...x, name: action.name } : x));
    }

    case "removeSection": {
      if (!ir.sections.some((s) => s.id === action.id)) return ir;
      return { ...ir, sections: ir.sections.filter((s) => s.id !== action.id) };
    }

    case "addPeriod": {
      const p = action.period;
      if (!ir.sections.some((s) => s.id === action.sectionId)) return ir;
      if (sectionOfPeriod(ir, p.id) !== undefined) return ir;
      if (timelineTextRejection(p.label) !== undefined) return ir;
      if (p.events.some((e) => timelineTextRejection(e.text) !== undefined)) return ir;
      return mapSections(ir, (s) => (s.id === action.sectionId ? { ...s, periods: [...s.periods, p] } : s));
    }

    case "updatePeriod": {
      const p = sectionOfPeriod(ir, action.id)?.periods.find((x) => x.id === action.id);
      if (!p || p.label === action.label) return ir;
      if (timelineTextRejection(action.label) !== undefined) return ir;
      return mapPeriods(ir, (x) => (x.id === action.id ? { ...x, label: action.label } : x));
    }

    case "movePeriod": {
      const s = sectionOfPeriod(ir, action.id);
      if (!s) return ir;
      const periods = swap(s.periods, s.periods.findIndex((p) => p.id === action.id), action.delta);
      if (!periods) return ir;
      return mapSections(ir, (x) => (x.id === s.id ? { ...x, periods } : x));
    }

    case "removePeriod": {
      if (sectionOfPeriod(ir, action.id) === undefined) return ir;
      return mapSections(ir, (s) => ({ ...s, periods: s.periods.filter((p) => p.id !== action.id) }));
    }

    case "addEvent": {
      const e = action.event;
      if (sectionOfPeriod(ir, action.periodId) === undefined) return ir;
      if (periodOfEvent(ir, e.id) !== undefined) return ir;
      if (timelineTextRejection(e.text) !== undefined) return ir;
      return mapPeriods(ir, (p) => (p.id === action.periodId ? { ...p, events: [...p.events, e] } : p));
    }

    case "updateEvent": {
      const e = periodOfEvent(ir, action.id)?.events.find((x) => x.id === action.id);
      if (!e || e.text === action.text) return ir;
      if (timelineTextRejection(action.text) !== undefined) return ir;
      return mapPeriods(ir, (p) => ({
        ...p,
        events: p.events.map((x) => (x.id === action.id ? { ...x, text: action.text } : x)),
      }));
    }

    case "moveEvent": {
      const p = periodOfEvent(ir, action.id);
      if (!p) return ir;
      const events = swap(p.events, p.events.findIndex((e) => e.id === action.id), action.delta);
      if (!events) return ir;
      return mapPeriods(ir, (x) => (x.id === p.id ? { ...x, events } : x));
    }

    case "removeEvent": {
      if (periodOfEvent(ir, action.id) === undefined) return ir;
      return mapPeriods(ir, (p) => ({ ...p, events: p.events.filter((e) => e.id !== action.id) }));
    }
  }
}
