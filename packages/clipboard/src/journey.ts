import type { JourneyIR, JourneySection, JourneyTask } from "@gmermaid/ir";
import { JOURNEY_MAX_SCORE, JOURNEY_MIN_SCORE, journeyTaskNameRejection, newId, sanitizeJourneyText } from "@gmermaid/ir";
import type { KindClipboard, MergeResult } from "./kind";

/**
 * Closure: the opposite containment rule to the graph kinds — a selected task
 * KEEPS its section, pruned to the selected tasks, because a section is this
 * kind's spine and only the very first one may be unnamed. A selected section
 * pulls all its tasks. The title is not copied: it names the whole diagram.
 */
function slice(ir: JourneyIR, ids: ReadonlySet<string>): JourneyIR | undefined {
  const sections: JourneySection[] = ir.sections.flatMap((s) => {
    const tasks = ids.has(s.id) ? s.tasks : s.tasks.filter((t) => ids.has(t.id));
    return tasks.length === 0 ? [] : [{ ...s, tasks }];
  });
  return sections.length === 0 ? undefined : { kind: "journey", sections };
}

/** The task the reducer would have built from this one, or undefined when
 * it would have refused it. */
function clean(t: JourneyTask): JourneyTask | undefined {
  const name = sanitizeJourneyText(t.name);
  if (journeyTaskNameRejection(name) !== undefined) return undefined;
  const score = Math.min(JOURNEY_MAX_SCORE, Math.max(JOURNEY_MIN_SCORE, Math.round(t.score)));
  const actors: string[] = [];
  for (const a of t.actors) {
    const c = sanitizeJourneyText(a, { actor: true });
    if (c !== "" && !actors.includes(c)) actors.push(c);
  }
  return { id: newId("task"), name, score, actors };
}

function merge(ir: JourneyIR, inc: JourneyIR): MergeResult<JourneyIR> {
  const added: string[] = [];
  const sections: JourneySection[] = [];
  /** tasks of an unnamed pasted section. Only the FIRST section of a diagram
   * may be unnamed, so appending one to a diagram that already has sections
   * would merge it into its predecessor on the next round trip anyway — do
   * it here, where it is visible, instead of letting the text decide. */
  const leading: JourneyTask[] = [];

  for (const s of inc.sections) {
    const tasks = s.tasks.flatMap((t) => {
      const next = clean(t);
      if (next === undefined) return [];
      added.push(next.id);
      return [next];
    });
    if (tasks.length === 0) continue;
    const name = sanitizeJourneyText(s.name);
    if (name === "" && ir.sections.length > 0) {
      leading.push(...tasks);
      continue;
    }
    const id = newId("section");
    added.push(id);
    sections.push({ id, name, tasks });
  }

  if (sections.length === 0 && leading.length === 0) return { reason: "nothing in the clipboard could be pasted here" };

  // leading is only non-empty when the target already has sections
  const host = ir.sections[ir.sections.length - 1];
  const target =
    leading.length === 0 || host === undefined
      ? ir.sections
      : [...ir.sections.slice(0, -1), { ...host, tasks: [...host.tasks, ...leading] }];

  // the title is the target's: a paste must not rename the diagram
  return { ir: { ...ir, sections: [...target, ...sections] }, added };
}

export const journeyClipboard: KindClipboard<JourneyIR> = { slice, merge };
