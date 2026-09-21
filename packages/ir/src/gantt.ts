import type { SectionId, TaskId } from "./ids";

// Gantt charts: sections of tasks placed on a time axis. A task line is
// `Name : [tags…,] [id,] [start,] end` — mermaid's arity rules decide which
// optional part is which (see the parser), so the IR keeps the pieces apart
// instead of storing the raw metadata string. Dates stay as the user's text
// (interpreted through `dateFormat` at layout time); the IR never resolves
// them, so an unparseable date round-trips untouched. `includes`, `weekday`,
// `topAxis`, `displayMode`, `click` and accessibility statements are
// tolerated on import and dropped.

export const GANTT_TAGS = ["active", "done", "crit", "milestone", "vert"] as const;
export type GanttTag = (typeof GANTT_TAGS)[number];

export type GanttTaskStart =
  /** one-field form: starts where the previous task (in text order) ends */
  | { readonly kind: "prev" }
  | { readonly kind: "date"; readonly value: string }
  /** `after a b`: the latest end among the referenced tasks */
  | { readonly kind: "after"; readonly ids: readonly string[] };

export type GanttTaskEnd =
  | { readonly kind: "date"; readonly value: string }
  /** `3d`, `2.5h`, `500ms` … */
  | { readonly kind: "duration"; readonly value: string }
  /** `until a b`: the earliest start among the referenced tasks */
  | { readonly kind: "until"; readonly ids: readonly string[] };

export interface GanttTask {
  readonly id: TaskId;
  readonly name: string;
  /** The mermaid id (`a1` in `:a1, 2014-01-01, 30d`) — what `after`/`until`
   * refer to. Only representable in the text when a start is given, so a
   * "prev" start drops it on export. */
  readonly taskId?: string;
  readonly tags: readonly GanttTag[];
  readonly start: GanttTaskStart;
  readonly end: GanttTaskEnd;
}

export interface GanttSection {
  readonly id: SectionId;
  /** Empty only for the leading section: tasks written before any `section`. */
  readonly name: string;
  readonly tasks: readonly GanttTask[];
}

export type GanttWeekend = "friday" | "saturday";

export interface GanttIR {
  readonly kind: "gantt";
  readonly title?: string;
  /** dayjs-style tokens; absent = mermaid default `YYYY-MM-DD` */
  readonly dateFormat?: string;
  /** d3-time-format tokens; absent = mermaid default `%Y-%m-%d` */
  readonly axisFormat?: string;
  /** `1day`, `2week` … */
  readonly tickInterval?: string;
  /** `weekends`, weekday names, dates in `dateFormat` */
  readonly excludes?: readonly string[];
  readonly weekend?: GanttWeekend;
  /** `off`, or an inline style string */
  readonly todayMarker?: string;
  readonly inclusiveEndDates?: boolean;
  readonly sections: readonly GanttSection[];
}

export const GANTT_DEFAULT_DATE_FORMAT = "YYYY-MM-DD";
export const GANTT_DEFAULT_AXIS_FORMAT = "%Y-%m-%d";

export function emptyGantt(): GanttIR {
  return { kind: "gantt", sections: [] };
}

/** Every task in text order (sections flattened). */
export function ganttTasks(ir: GanttIR): readonly GanttTask[] {
  return ir.sections.flatMap((s) => s.tasks);
}

export function findGanttTask(ir: GanttIR, id: TaskId): { task: GanttTask; section: GanttSection } | undefined {
  for (const section of ir.sections) {
    const task = section.tasks.find((t) => t.id === id);
    if (task) return { task, section };
  }
  return undefined;
}
