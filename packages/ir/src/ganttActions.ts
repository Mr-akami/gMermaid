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

/** Statement keywords. A task line is `<name> :<meta>`, but mermaid reads a
 * line opening with one of these as that statement instead — the task would
 * be swallowed and would overwrite a chart option or open a section. */
const GANTT_KEYWORD_RE = /^(title|dateFormat|axisFormat|tickInterval|excludes|todayMarker|weekend|section)(\s|$)/;

/** Why `name` cannot be a task name, or undefined when it can. A nameless
 * task emits a line starting with `:`, which mermaid cannot read at all.
 * Shared by the reducer (reject) and the UI (show the reason). */
export function ganttTaskNameRejection(name: string): string | undefined {
  const clean = sanitizeGanttName(name);
  if (clean === "") return "task name cannot be empty";
  if (GANTT_KEYWORD_RE.test(clean)) return "a task name cannot start with a mermaid keyword (title, section, …)";
  return undefined;
}

/** Chart options are written bare after their keyword, so `%%` would comment
 * out the rest of the line and a line break would end the statement. */
function normOption(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const clean = v.replaceAll(/%%+/g, "").replaceAll(/[\r\n]+/g, " ").trim();
  return clean === "" ? undefined : clean;
}

/** `excludes` is emitted space-joined and read back split on whitespace and
 * commas, so each entry has to be a single token of its own. */
function normExcludes(values: readonly string[]): readonly string[] | undefined {
  const out: string[] = [];
  for (const v of values) {
    for (const token of v.split(/[\s,]+/)) {
      const clean = normOption(token);
      if (clean !== undefined && !out.includes(clean)) out.push(clean);
    }
  }
  return out.length > 0 ? out : undefined;
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
      const index = ir.sections.findIndex((x) => x.id === action.id);
      if (index < 0) return ir;
      const s = ir.sections[index]!;
      const name = sanitizeGanttName(action.name);
      // a nameless section emits no header, so only the first one — whose
      // tasks sit before any `section` — survives the round trip
      if (name === "" && index !== 0) return ir;
      if (name === s.name) return ir;
      return mapSection(ir, action.id, (x) => ({ ...x, name }));
    }

    case "removeSection": {
      if (!ir.sections.some((s) => s.id === action.id)) return ir;
      return { ...ir, sections: ir.sections.filter((s) => s.id !== action.id) };
    }

    case "moveSection": {
      const from = ir.sections.findIndex((s) => s.id === action.id);
      const to = from + action.delta;
      // the nameless section can only ever be first (see updateSection)
      if (from >= 0 && to >= 0 && to < ir.sections.length && (ir.sections[from]!.name === "" || ir.sections[to]!.name === ""))
        return ir;
      const next = move(ir.sections, from, action.delta);
      return next === undefined ? ir : { ...ir, sections: next };
    }

    case "addTask": {
      const t = action.task;
      if (sectionOfTask(ir, t.id)) return ir;
      if (!ir.sections.some((s) => s.id === action.sectionId)) return ir;
      if (ganttTaskNameRejection(t.name) !== undefined) return ir;
      const task = normalizeTask(t);
      return mapSection(ir, action.sectionId, (s) => ({ ...s, tasks: [...s.tasks, task] }));
    }

    case "updateTask": {
      const section = sectionOfTask(ir, action.id);
      if (!section) return ir;
      const t = section.tasks.find((x) => x.id === action.id)!;
      const p = action.patch;
      if (p.name !== undefined && ganttTaskNameRejection(p.name) !== undefined) return ir;
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
        title: "title" in p ? normOption(p.title) : ir.title,
        dateFormat: "dateFormat" in p ? normOption(p.dateFormat) : ir.dateFormat,
        axisFormat: "axisFormat" in p ? normOption(p.axisFormat) : ir.axisFormat,
        tickInterval: "tickInterval" in p ? normOption(p.tickInterval) : ir.tickInterval,
        excludes: "excludes" in p ? (p.excludes ? normExcludes(p.excludes) : undefined) : ir.excludes,
        weekend: "weekend" in p ? p.weekend : ir.weekend,
        todayMarker: "todayMarker" in p ? normOption(p.todayMarker) : ir.todayMarker,
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
