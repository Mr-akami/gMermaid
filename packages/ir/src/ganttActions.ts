import { newId, type SectionId, type TaskId } from "./ids";
import type { GanttIR, GanttSection, GanttTag, GanttTask, GanttTaskEnd, GanttTaskStart, GanttWeekend } from "./gantt";
import { omitUndefined } from "./omitUndefined";

// Same contract as the other diagram actions: intent-carrying, immutable,
// identity-preserving on no-ops.

/** What `after`/`until` can reference: mermaid's id regex is `[\d\w-]+`. */
export const GANTT_TASK_ID_RE = /^[\w-]+$/;

/** Task names sit before the `:` on a task line; `:` would split the line,
 * `#`/`;` end the line in mermaid's lexer and `%` opens a comment. */
export function sanitizeGanttName(name: string): string {
  return name.replaceAll(/[:#;%]/g, " ").replaceAll(/\s+/g, " ").trim();
}

export function newTaskId(): TaskId {
  return newId("task");
}

export function newSectionId(): SectionId {
  return newId("section");
}

export interface GanttOptions {
  readonly title?: string;
  readonly dateFormat?: string;
  readonly axisFormat?: string;
  readonly tickInterval?: string;
  readonly excludes?: readonly string[];
  readonly weekend?: GanttWeekend;
  readonly todayMarker?: string;
  readonly inclusiveEndDates?: boolean;
}

export interface GanttTaskPatch {
  readonly name?: string;
  /** empty string clears */
  readonly taskId?: string;
  readonly tags?: readonly GanttTag[];
  readonly start?: GanttTaskStart;
  readonly end?: GanttTaskEnd;
}

export type GanttAction =
  | { type: "addSection"; section: { id: SectionId; name: string } }
  | { type: "updateSection"; id: SectionId; name: string }
  | { type: "removeSection"; id: SectionId }
  | { type: "moveSection"; id: SectionId; delta: -1 | 1 }
  | { type: "addTask"; sectionId: SectionId; task: GanttTask }
  | { type: "updateTask"; id: TaskId; patch: GanttTaskPatch }
  | { type: "removeTask"; id: TaskId }
  /** within its section; clamps at the ends (no-op) */
  | { type: "moveTask"; id: TaskId; delta: -1 | 1 }
  /** a key present with "" / [] / false clears that option */
  | { type: "setGanttOptions"; patch: GanttOptions };

const norm = (v: string | undefined) => (v === undefined || v.trim() === "" ? undefined : v.trim());

function move<T>(list: readonly T[], index: number, delta: -1 | 1): readonly T[] | undefined {
  const target = index + delta;
  if (index < 0 || target < 0 || target >= list.length) return undefined;
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

function mapSection(ir: GanttIR, id: SectionId, f: (s: GanttSection) => GanttSection): GanttIR {
  return { ...ir, sections: ir.sections.map((s) => (s.id === id ? f(s) : s)) };
}

function sectionOfTask(ir: GanttIR, id: TaskId): GanttSection | undefined {
  return ir.sections.find((s) => s.tasks.some((t) => t.id === id));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function applyGanttAction(ir: GanttIR, action: GanttAction): GanttIR {
  switch (action.type) {
    case "addSection": {
      if (ir.sections.some((s) => s.id === action.section.id)) return ir;
      // only the leading section may be nameless (tasks before any `section`)
      const name = sanitizeGanttName(action.section.name);
      if (name === "" && ir.sections.length > 0) return ir;
      return { ...ir, sections: [...ir.sections, { id: action.section.id, name, tasks: [] }] };
    }

    case "updateSection": {
      const s = ir.sections.find((x) => x.id === action.id);
      if (!s) return ir;
      const name = sanitizeGanttName(action.name);
      if (name === s.name) return ir;
      return mapSection(ir, action.id, (x) => ({ ...x, name }));
    }

    case "removeSection": {
      if (!ir.sections.some((s) => s.id === action.id)) return ir;
      return { ...ir, sections: ir.sections.filter((s) => s.id !== action.id) };
    }

    case "moveSection": {
      const next = move(ir.sections, ir.sections.findIndex((s) => s.id === action.id), action.delta);
      return next === undefined ? ir : { ...ir, sections: next };
    }

    case "addTask": {
      const t = action.task;
      if (sectionOfTask(ir, t.id)) return ir;
      if (!ir.sections.some((s) => s.id === action.sectionId)) return ir;
      const task = normalizeTask(t);
      return mapSection(ir, action.sectionId, (s) => ({ ...s, tasks: [...s.tasks, task] }));
    }

    case "updateTask": {
      const section = sectionOfTask(ir, action.id);
      if (!section) return ir;
      const t = section.tasks.find((x) => x.id === action.id)!;
      const p = action.patch;
      const next = normalizeTask({
        ...t,
        ...(p.name !== undefined ? { name: p.name } : {}),
        ...(p.taskId !== undefined ? { taskId: p.taskId } : {}),
        ...(p.tags !== undefined ? { tags: p.tags } : {}),
        ...(p.start !== undefined ? { start: p.start } : {}),
        ...(p.end !== undefined ? { end: p.end } : {}),
      });
      if (same(next, t)) return ir;
      return mapSection(ir, section.id, (s) => ({ ...s, tasks: s.tasks.map((x) => (x.id === action.id ? next : x)) }));
    }

    case "removeTask": {
      const section = sectionOfTask(ir, action.id);
      if (!section) return ir;
      return mapSection(ir, section.id, (s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== action.id) }));
    }

    case "moveTask": {
      const section = sectionOfTask(ir, action.id);
      if (!section) return ir;
      const next = move(section.tasks, section.tasks.findIndex((t) => t.id === action.id), action.delta);
      return next === undefined ? ir : mapSection(ir, section.id, (s) => ({ ...s, tasks: next }));
    }

    case "setGanttOptions": {
      const p = action.patch;
      const next: GanttIR = omitUndefined({
        ...ir,
        title: "title" in p ? norm(p.title) : ir.title,
        dateFormat: "dateFormat" in p ? norm(p.dateFormat) : ir.dateFormat,
        axisFormat: "axisFormat" in p ? norm(p.axisFormat) : ir.axisFormat,
        tickInterval: "tickInterval" in p ? norm(p.tickInterval) : ir.tickInterval,
        excludes: "excludes" in p ? (p.excludes && p.excludes.length > 0 ? p.excludes : undefined) : ir.excludes,
        weekend: "weekend" in p ? p.weekend : ir.weekend,
        todayMarker: "todayMarker" in p ? norm(p.todayMarker) : ir.todayMarker,
        inclusiveEndDates: "inclusiveEndDates" in p ? (p.inclusiveEndDates ? true : undefined) : ir.inclusiveEndDates,
      });
      return same(next, ir) ? ir : next;
    }
  }
}

/** Keep a task expressible in mermaid text: a clean name, an id-safe taskId,
 * unique tags, id-safe reference lists. */
function normalizeTask(t: GanttTask): GanttTask {
  const name = sanitizeGanttName(t.name);
  const rawId = t.taskId?.trim() ?? "";
  // mermaid only reads an id when a start is written too (3-field form), so
  // an id on a "starts after the previous task" task cannot survive export
  const taskId = GANTT_TASK_ID_RE.test(rawId) && t.start.kind !== "prev" ? rawId : undefined;
  const tags = t.tags.filter((tag, i) => t.tags.indexOf(tag) === i);
  return omitUndefined({ ...t, name, taskId, tags, start: cleanRefs(t.start), end: cleanRefs(t.end) });
}

function cleanRefs<T extends GanttTaskStart | GanttTaskEnd>(v: T): T {
  if (v.kind === "after" || v.kind === "until") {
    return { ...v, ids: v.ids.map((id) => id.trim()).filter((id) => GANTT_TASK_ID_RE.test(id)) };
  }
  return v;
}
