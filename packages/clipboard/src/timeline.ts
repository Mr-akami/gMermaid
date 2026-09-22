import type { TimelineEvent, TimelineIR, TimelinePeriod, TimelineSection } from "@gmermaid/ir";
import { newId, timelineTextRejection } from "@gmermaid/ir";
import type { KindClipboard, MergeResult } from "./kind";

/**
 * Closure: an event keeps its period and its section, a period keeps its
 * section — the same "the container is the spine" rule as journey and gantt.
 * A selected section or period pulls everything below it. The title is not
 * copied: it names the whole diagram.
 */
function slice(ir: TimelineIR, ids: ReadonlySet<string>): TimelineIR | undefined {
  const sections: TimelineSection[] = ir.sections.flatMap((s) => {
    const whole = ids.has(s.id);
    const periods: TimelinePeriod[] = s.periods.flatMap((p) => {
      const wholePeriod = whole || ids.has(p.id);
      const events = wholePeriod ? p.events : p.events.filter((e) => ids.has(e.id));
      if (!wholePeriod && events.length === 0) return [];
      return [{ ...p, events }];
    });
    return periods.length === 0 ? [] : [{ ...s, periods }];
  });
  return sections.length === 0 ? undefined : { kind: "timeline", sections };
}

function merge(ir: TimelineIR, inc: TimelineIR): MergeResult<TimelineIR> {
  const added: string[] = [];
  const sections: TimelineSection[] = [];
  /** same rule as journey: only the FIRST section of a diagram may be
   * unnamed, so an unnamed pasted one folds into the target's last section */
  const leading: TimelinePeriod[] = [];

  const keep = (periods: readonly TimelinePeriod[]): void => {
    for (const p of periods) {
      added.push(p.id);
      for (const e of p.events) added.push(e.id);
    }
  };

  for (const s of inc.sections) {
    if (s.name !== "" && timelineTextRejection(s.name) !== undefined) continue;
    const periods: TimelinePeriod[] = s.periods.flatMap((p) => {
      if (timelineTextRejection(p.label) !== undefined) return [];
      const events: TimelineEvent[] = p.events.flatMap((e) =>
        timelineTextRejection(e.text) === undefined ? [{ id: newId("event"), text: e.text }] : [],
      );
      return [{ id: newId("period"), label: p.label, events }];
    });
    if (periods.length === 0) continue;
    keep(periods);
    if (s.name === "" && ir.sections.length > 0) {
      leading.push(...periods);
      continue;
    }
    const id = newId("section");
    added.push(id);
    sections.push({ id, name: s.name, periods });
  }

  if (sections.length === 0 && leading.length === 0) return { reason: "nothing in the clipboard could be pasted here" };

  // leading is only non-empty when the target already has sections
  const host = ir.sections[ir.sections.length - 1];
  const target =
    leading.length === 0 || host === undefined
      ? ir.sections
      : [...ir.sections.slice(0, -1), { ...host, periods: [...host.periods, ...leading] }];

  // the title is the target's: a paste must not rename the diagram
  return { ir: { ...ir, sections: [...target, ...sections] }, added };
}

export const timelineClipboard: KindClipboard<TimelineIR> = { slice, merge };
