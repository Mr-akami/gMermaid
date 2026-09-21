import {
  GANTT_DEFAULT_AXIS_FORMAT,
  GANTT_DEFAULT_DATE_FORMAT,
  type GanttIR,
  type GanttTag,
  type GanttTask,
  type SectionId,
  type TaskId,
} from "@gmermaid/ir";
import { collisionIndex, inflate, labelRect } from "./collision";
import type { TextMeasurer } from "./measurer";
import type { Rect } from "./result";
import { chooseTickStep, DAY_MS, formatGanttDate, parseGanttDate, parseGanttDuration, parseTickInterval } from "./ganttTime";

// Gantt layout: resolve every task to a [start, end) instant pair, then map
// that time domain onto a fixed-width chart area. Tasks whose dates cannot be
// resolved (bad date, dangling `after`, cyclic references) are NOT dropped —
// they fall back to sequential placement and carry `unresolved: true` so the
// renderer can mark them. `excludes` is carried in the IR and emitted, but
// deliberately not applied to the date math (mermaid stretches tasks over
// excluded days; that needs a calendar the layout does not have).

const TITLE_H = 30;
const AXIS_H = 28;
const ROW_H = 22;
const ROW_GAP = 6;
const SECTION_GAP = 8;
const SECTION_LABEL_PAD = 6;
/** Where the renderer starts a section's name inside its band. */
const SECTION_TEXT_X = 8;
/** Baseline of an axis tick label, above the axis line. */
const TICK_TEXT_DY = 8;
const TICK_STYLE = { fontSize: 11, fontFamily: "sans-serif" } as const;
/** Clear space either side of a tick label before it counts as crowded. */
const TICK_GAP = 6;
const CHART_W = 680;
const MIN_LABEL_W = 110;
const MAX_LABEL_W = 260;
const LABEL_PAD = 12;
const MIN_BAR_W = 2;
const MAX_TICKS = 9;
const LABEL_STYLE = { fontSize: 12, fontFamily: "sans-serif" } as const;
/** Width of an unresolved task's fallback bar, and of an empty chart's span. */
const FALLBACK_SPAN = DAY_MS;

export interface GanttBar {
  readonly id: TaskId;
  readonly label: string;
  readonly rect: Rect;
  readonly tags: readonly GanttTag[];
  /** Milestones are drawn as a diamond at start + duration / 2. */
  readonly milestone: boolean;
  /** Dates could not be resolved — position is sequential guesswork. */
  readonly unresolved: boolean;
  /** Left gutter label baseline row (same y band as the bar). */
  readonly labelRect: Rect;
}

/** `vert` tasks take no row: they are full-height marker lines. */
export interface GanttVert {
  readonly id: TaskId;
  readonly label: string;
  readonly x: number;
  readonly unresolved: boolean;
}

export interface GanttSectionBand {
  readonly id: SectionId;
  readonly name: string;
  readonly rect: Rect;
  /** Alternating bands, like mermaid's section styles. */
  readonly index: number;
}

export interface GanttTick {
  readonly x: number;
  /** Absent when the axis is too dense for this one — the gridline stays. */
  readonly label?: string;
}

export interface GanttLayout {
  readonly kind: "gantt";
  readonly size: { readonly w: number; readonly h: number };
  readonly title?: string;
  /** x of the chart area's left edge (task labels live to the left of it). */
  readonly chartX: number;
  readonly chartW: number;
  /** y of the axis line; rows start below it. */
  readonly axisY: number;
  readonly rowsTop: number;
  readonly rowsBottom: number;
  readonly sections: readonly GanttSectionBand[];
  readonly bars: readonly GanttBar[];
  readonly verts: readonly GanttVert[];
  readonly ticks: readonly GanttTick[];
  /** Present only when the marker is enabled and `now` falls inside the axis. */
  readonly todayX?: number;
}

interface Resolved {
  start?: number;
  end?: number;
}

/**
 * `now` is injected so the today marker cannot make layout non-deterministic
 * (ADR 0001: layout is a pure function of its arguments).
 */
export function layoutGantt(ir: GanttIR, measure: TextMeasurer, now: number = Date.now()): GanttLayout {
  const dateFormat = ir.dateFormat ?? GANTT_DEFAULT_DATE_FORMAT;
  const axisFormat = ir.axisFormat ?? GANTT_DEFAULT_AXIS_FORMAT;
  const tasks = ir.sections.flatMap((s) => s.tasks);
  const times = resolveTimes(tasks, dateFormat, ir.inclusiveEndDates === true);

  const [domainStart, domainEnd] = domainOf(times);
  const scale = (ms: number): number => chartX + ((ms - domainStart) / (domainEnd - domainStart)) * CHART_W;

  // The gutter is two columns, not one: a section's name is drawn at the top
  // left of its band, on the same row as its first task's right-aligned name.
  // One shared column puts them on top of each other, so each gets its own.
  const sectionW = Math.max(
    0,
    ...ir.sections.map((s) => (s.name === "" ? 0 : measure.measure(s.name, LABEL_STYLE).w + SECTION_TEXT_X + SECTION_LABEL_PAD)),
  );
  const taskW = Math.min(
    MAX_LABEL_W,
    Math.max(MIN_LABEL_W, ...tasks.map((t) => measure.measure(t.name, LABEL_STYLE).w + LABEL_PAD * 2)),
  );
  const labelW = sectionW + taskW;
  const chartX = labelW;
  const titleH = ir.title !== undefined ? TITLE_H : 0;
  const axisY = titleH + AXIS_H;

  const sections: GanttSectionBand[] = [];
  const bars: GanttBar[] = [];
  const verts: GanttVert[] = [];
  let y = axisY + SECTION_GAP;

  for (const [index, section] of ir.sections.entries()) {
    const bandTop = y;
    for (const task of section.tasks) {
      const t = times.get(task.id)!;
      if (task.tags.includes("vert")) {
        verts.push({ id: task.id, label: task.name, x: scale(t.start!), unresolved: t.unresolved });
        continue;
      }
      bars.push(bar(task, t, y, scale, sectionW, taskW));
      y += ROW_H + ROW_GAP;
    }
    // an empty section still needs a visible, clickable band
    if (section.tasks.length === 0) y += ROW_H + ROW_GAP;
    sections.push({
      id: section.id,
      name: section.name,
      rect: { x: 0, y: bandTop - SECTION_LABEL_PAD, w: labelW + CHART_W, h: y - bandTop + SECTION_LABEL_PAD },
      index,
    });
    y += SECTION_GAP;
  }

  const rowsTop = axisY + SECTION_GAP;
  const rowsBottom = Math.max(y, rowsTop + ROW_H);

  const ticks: GanttTick[] = [];
  const step = (ir.tickInterval !== undefined ? parseTickInterval(ir.tickInterval) : undefined)
    ?? chooseTickStep(domainEnd - domainStart, MAX_TICKS);
  // A tick step chosen from the time domain says nothing about how wide the
  // formatted dates are, so the labels can still crowd. Keep the gridlines and
  // thin the labels out left to right: the first one always wins, and a later
  // one is dropped only when it would land on a label already kept.
  const axisRoom = collisionIndex();
  for (let t = Math.ceil(domainStart / step) * step; t <= domainEnd; t += step) {
    const x = scale(t);
    const label = formatGanttDate(t, axisFormat);
    const box = inflate(labelRect({ x, y: axisY - TICK_TEXT_DY }, measure.measure(label, TICK_STYLE)), TICK_GAP);
    // a dropped label is not drawn, so it must not block the next one either
    if (axisRoom.hits(box)) ticks.push({ x });
    else {
      axisRoom.add(box);
      ticks.push({ x, label });
    }
  }

  const showToday = ir.todayMarker !== "off" && now >= domainStart && now <= domainEnd;

  return {
    kind: "gantt",
    size: { w: labelW + CHART_W + LABEL_PAD, h: rowsBottom + LABEL_PAD },
    ...(ir.title !== undefined ? { title: ir.title } : {}),
    chartX,
    chartW: CHART_W,
    axisY,
    rowsTop,
    rowsBottom,
    sections,
    bars,
    verts,
    ticks,
    ...(showToday ? { todayX: scale(now) } : {}),
  };
}

function bar(
  task: GanttTask,
  t: ResolvedTime,
  y: number,
  scale: (ms: number) => number,
  sectionW: number,
  taskW: number,
): GanttBar {
  const milestone = task.tags.includes("milestone");
  // mermaid puts a milestone at start + duration / 2, as a point
  const x0 = scale(milestone ? (t.start! + t.end!) / 2 : t.start!);
  const x1 = milestone ? x0 : scale(t.end!);
  return {
    id: task.id,
    label: task.name,
    rect: { x: x0, y, w: Math.max(MIN_BAR_W, x1 - x0), h: ROW_H },
    tags: task.tags,
    milestone,
    unresolved: t.unresolved,
    labelRect: { x: sectionW, y, w: taskW, h: ROW_H },
  };
}

interface ResolvedTime {
  readonly start?: number;
  readonly end?: number;
  readonly unresolved: boolean;
}

type TimeMap = Map<TaskId, ResolvedTime & { start: number; end: number }>;

/**
 * Resolve every task's instants. References may point forward, so the pass is
 * repeated until it stops making progress (mermaid iterates too); whatever is
 * still open afterwards gets sequential fallback placement.
 */
function resolveTimes(tasks: readonly GanttTask[], dateFormat: string, inclusiveEndDates: boolean): TimeMap {
  const open = new Map<TaskId, Resolved>(tasks.map((t) => [t.id, {}]));
  const byTaskId = new Map<string, GanttTask>();
  for (const t of tasks) if (t.taskId !== undefined) byTaskId.set(t.taskId, t);

  const endOf = (id: string): number | undefined => {
    const task = byTaskId.get(id);
    return task === undefined ? undefined : open.get(task.id)?.end;
  };
  const startOf = (id: string): number | undefined => {
    const task = byTaskId.get(id);
    return task === undefined ? undefined : open.get(task.id)?.start;
  };

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const [i, task] of tasks.entries()) {
      const r = open.get(task.id)!;
      if (r.start === undefined) {
        const start = resolveStart(task, i, tasks, open, dateFormat, endOf);
        if (start !== undefined) {
          r.start = start;
          progressed = true;
        }
      }
      if (r.start !== undefined && r.end === undefined) {
        const end = resolveEnd(task, r.start, dateFormat, inclusiveEndDates, startOf);
        if (end !== undefined) {
          r.end = end;
          progressed = true;
        }
      }
    }
  }

  // sequential fallback, in text order, starting at the earliest known instant
  const known = [...open.values()].flatMap((r) => (r.start !== undefined ? [r.start] : []));
  let cursor = known.length > 0 ? Math.min(...known) : 0;
  const out: TimeMap = new Map();
  for (const task of tasks) {
    const r = open.get(task.id)!;
    const unresolved = r.start === undefined || r.end === undefined;
    const start = r.start ?? cursor;
    const end = Math.max(r.end ?? start + FALLBACK_SPAN, start);
    out.set(task.id, { start, end, unresolved });
    cursor = end;
  }
  return out;
}

function resolveStart(
  task: GanttTask,
  index: number,
  tasks: readonly GanttTask[],
  open: Map<TaskId, Resolved>,
  dateFormat: string,
  endOf: (id: string) => number | undefined,
): number | undefined {
  switch (task.start.kind) {
    case "date":
      return parseGanttDate(task.start.value, dateFormat);
    case "prev": {
      const prev = tasks[index - 1];
      // the first task of a chart has nothing to follow
      return prev === undefined ? undefined : open.get(prev.id)?.end;
    }
    case "after": {
      const ends = task.start.ids.flatMap((id) => {
        const end = endOf(id);
        return end === undefined ? [] : [end];
      });
      return ends.length > 0 ? Math.max(...ends) : undefined;
    }
  }
}

function resolveEnd(
  task: GanttTask,
  start: number,
  dateFormat: string,
  inclusiveEndDates: boolean,
  startOf: (id: string) => number | undefined,
): number | undefined {
  switch (task.end.kind) {
    case "date": {
      const at = parseGanttDate(task.end.value, dateFormat);
      // `inclusiveEndDates` makes the written day part of the task
      return at === undefined ? undefined : inclusiveEndDates ? at + DAY_MS : at;
    }
    case "duration": {
      const ms = parseGanttDuration(task.end.value);
      return ms === undefined ? undefined : start + ms;
    }
    case "until": {
      const starts = task.end.ids.flatMap((id) => {
        const at = startOf(id);
        return at === undefined ? [] : [at];
      });
      return starts.length > 0 ? Math.min(...starts) : undefined;
    }
  }
}

function domainOf(times: TimeMap): [number, number] {
  const values = [...times.values()];
  if (values.length === 0) return [0, FALLBACK_SPAN];
  const start = Math.min(...values.map((t) => t.start));
  const end = Math.max(...values.map((t) => t.end));
  // a chart of pure milestones has zero span: give the axis something to map
  return end > start ? [start, end] : [start, start + FALLBACK_SPAN];
}
