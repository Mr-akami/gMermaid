import type { GanttIR, GanttSection, GanttTask, GanttTaskEnd, GanttTaskStart } from "@gmermaid/ir";
import { GANTT_TASK_ID_RE, ganttTaskNameRejection, newId, omitUndefined, sanitizeGanttName } from "@gmermaid/ir";
import type { KindClipboard, MergeResult } from "./kind";
import { saturate, uniqueName } from "./kind";

/** The mermaid task ids a task's `after` / `until` names. A gantt dependency
 * is an edge, so it closes like one. */
function referencedTaskIds(t: GanttTask): readonly string[] {
  return [...(t.start.kind === "after" ? t.start.ids : []), ...(t.end.kind === "until" ? t.end.ids : [])];
}

/**
 * Closure: a selected task keeps its section (pruned), a selected section
 * pulls its tasks, and `after` / `until` pull the tasks they name — with
 * their sections — transitively. Chart options travel so the copied dates
 * still read the way they were written; the title does not.
 */
function slice(ir: GanttIR, ids: ReadonlySet<string>): GanttIR | undefined {
  const all = ir.sections.flatMap((s) => s.tasks);
  const byTaskId = new Map<string, GanttTask>();
  for (const t of all) if (t.taskId !== undefined) byTaskId.set(t.taskId, t);

  const seed = all
    .filter((t) => ids.has(t.id) || ir.sections.some((s) => ids.has(s.id) && s.tasks.includes(t)))
    .map((t) => t.id as string);
  const kept = saturate(seed, (have) =>
    all
      .filter((t) => have.has(t.id))
      .flatMap(referencedTaskIds)
      .flatMap((ref) => {
        const t = byTaskId.get(ref);
        return t === undefined ? [] : [t.id as string];
      }),
  );
  if (kept.size === 0) return undefined;

  const sections: GanttSection[] = ir.sections.flatMap((s) => {
    const tasks = s.tasks.filter((t) => kept.has(t.id));
    return tasks.length === 0 ? [] : [{ ...s, tasks }];
  });

  return omitUndefined({
    kind: "gantt" as const,
    dateFormat: ir.dateFormat,
    axisFormat: ir.axisFormat,
    tickInterval: ir.tickInterval,
    excludes: ir.excludes,
    weekend: ir.weekend,
    todayMarker: ir.todayMarker,
    inclusiveEndDates: ir.inclusiveEndDates,
    sections,
  });
}

function merge(ir: GanttIR, inc: GanttIR): MergeResult<GanttIR> {
  // mermaid task ids are what `after` / `until` name, so they are identity
  const taskIds = new Set<string>();
  for (const s of ir.sections) for (const t of s.tasks) if (t.taskId !== undefined) taskIds.add(t.taskId);

  const rename = new Map<string, string>();
  for (const s of inc.sections) {
    for (const t of s.tasks) {
      if (t.taskId === undefined || !GANTT_TASK_ID_RE.test(t.taskId)) continue;
      rename.set(t.taskId, uniqueName(t.taskId, taskIds));
    }
  }
  const resolve = (refs: readonly string[]): readonly string[] =>
    refs.flatMap((r) => {
      const next = rename.get(r);
      return next === undefined ? [] : [next];
    });

  const added: string[] = [];
  const sections: GanttSection[] = [];
  /** same rule as journey and timeline: only the FIRST section of a chart may
   * be unnamed, so an unnamed pasted one folds into the target's last one */
  const leading: GanttTask[] = [];
  for (const s of inc.sections) {
    const tasks: GanttTask[] = [];
    for (const t of s.tasks) {
      const name = sanitizeGanttName(t.name);
      if (ganttTaskNameRejection(name) !== undefined) continue;

      // a reference out of the pasted set is dropped. `after` then falls back
      // to "where the previous task ends", which is still a defined place;
      // `until` has no such fallback, so a task that loses every reference
      // loses its end and is dropped with it.
      let start: GanttTaskStart = t.start;
      if (t.start.kind === "after") {
        const refs = resolve(t.start.ids);
        start = refs.length === 0 ? { kind: "prev" } : { kind: "after", ids: refs };
      }
      let end: GanttTaskEnd | undefined = t.end;
      if (t.end.kind === "until") {
        const refs = resolve(t.end.ids);
        end = refs.length === 0 ? undefined : { kind: "until", ids: refs };
      }
      if (end === undefined) continue;

      const id = newId("task");
      added.push(id);
      tasks.push(
        omitUndefined({
          id,
          name,
          taskId: t.taskId === undefined ? undefined : rename.get(t.taskId),
          tags: t.tags,
          start,
          end,
        }),
      );
    }
    if (tasks.length === 0) continue;
    const name = sanitizeGanttName(s.name);
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

  // chart options and the title are the target's: a paste must not re-date
  // or rename the chart it lands in
  return { ir: { ...ir, sections: [...target, ...sections] }, added };
}

export const ganttClipboard: KindClipboard<GanttIR> = { slice, merge };
