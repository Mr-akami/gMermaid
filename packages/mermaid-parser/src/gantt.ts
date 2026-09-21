import {
  GANTT_TAGS,
  type GanttIR,
  type GanttSection,
  type GanttTag,
  type GanttTask,
  type GanttTaskEnd,
  type GanttTaskStart,
  type SectionId,
  type TaskId,
} from "@gmermaid/ir";
import { prepareLines, type ParseError, type ParseResult } from "./common";

// gantt subset: title / dateFormat / axisFormat / tickInterval / excludes /
// weekend / todayMarker / inclusiveEndDates, `section X`, and task lines
// `Name : meta`. Dialect the IR cannot hold is DISCARDED by design, same as
// `%%` comments: frontmatter, `%%{init}%%`, `includes`, `weekday`, `topAxis`,
// `click`, `accTitle` / `accDescr` and trailing `;`.

const DROPPED = ["accTitle", "accDescr", "click", "includes", "weekday", "topAxis", "displayMode"];

/** Mermaid's own duration grammar (`3d`, `1.5h`, `500ms`); anything else in
 * the end slot is read as a date. */
const DURATION_RE = /^\d+(?:\.\d+)?(?:ms|[Mdhmswy])$/;

const TAGS: readonly string[] = GANTT_TAGS;

export function parseGantt(code: string): ParseResult<GanttIR> {
  const errors: ParseError[] = [];
  const lines = prepareLines(code, { drop: DROPPED });

  interface DraftSection {
    readonly id: SectionId;
    readonly name: string;
    readonly tasks: GanttTask[];
  }
  const sections: DraftSection[] = [];
  let current: DraftSection | undefined;
  let headerSeen = false;
  let taskSeq = 0;
  let sectionSeq = 0;
  const opts: {
    title?: string;
    dateFormat?: string;
    axisFormat?: string;
    tickInterval?: string;
    excludes?: string[];
    weekend?: "friday" | "saturday";
    todayMarker?: string;
    inclusiveEndDates?: boolean;
  } = {};

  // tasks written before the first `section` live in a nameless leading
  // section — mermaid keeps them in an unnamed group too
  const section = (): DraftSection => {
    if (current === undefined) {
      sectionSeq += 1;
      current = { id: `section-${sectionSeq}` as SectionId, name: "", tasks: [] };
      sections.push(current);
    }
    return current;
  };

  for (const { text: line, line: lineNo } of lines) {
    if (!headerSeen) {
      if (line !== "gantt") {
        errors.push({ line: lineNo, message: "expected `gantt` header" });
        return { ok: false, errors };
      }
      headerSeen = true;
      continue;
    }

    const kv = line.match(/^(title|dateFormat|axisFormat|tickInterval|excludes|todayMarker)\s+(.+)$/);
    if (kv) {
      const value = kv[2]!.trim();
      switch (kv[1]) {
        case "title":
          opts.title = value;
          break;
        case "dateFormat":
          opts.dateFormat = value;
          break;
        case "axisFormat":
          opts.axisFormat = value;
          break;
        case "tickInterval":
          opts.tickInterval = value;
          break;
        case "todayMarker":
          opts.todayMarker = value;
          break;
        case "excludes":
          // multiple `excludes` lines concatenate (mermaid merges tokens)
          opts.excludes = [...(opts.excludes ?? []), ...value.split(/[\s,]+/).filter((t) => t !== "")];
          break;
      }
      continue;
    }

    if (line === "inclusiveEndDates") {
      opts.inclusiveEndDates = true;
      continue;
    }

    const weekend = line.match(/^weekend\s+(friday|saturday)$/);
    if (weekend) {
      opts.weekend = weekend[1] as "friday" | "saturday";
      continue;
    }

    const sec = line.match(/^section\s+(.+)$/);
    if (sec) {
      sectionSeq += 1;
      current = { id: `section-${sectionSeq}` as SectionId, name: sec[1]!.trim(), tasks: [] };
      sections.push(current);
      continue;
    }

    const colon = line.indexOf(":");
    if (colon > 0) {
      const name = line.slice(0, colon).trim();
      const meta = line.slice(colon + 1).trim();
      const parsed = parseTaskMeta(meta);
      if (typeof parsed === "string") {
        errors.push({ line: lineNo, message: parsed });
        continue;
      }
      taskSeq += 1;
      section().tasks.push({ id: `task-${taskSeq}` as TaskId, name, ...parsed });
      continue;
    }

    errors.push({ line: lineNo, message: `cannot parse: ${line}` });
  }

  if (!headerSeen) errors.push({ line: 1, message: "empty diagram: missing header" });
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    ir: {
      kind: "gantt",
      ...(opts.title !== undefined ? { title: opts.title } : {}),
      ...(opts.dateFormat !== undefined ? { dateFormat: opts.dateFormat } : {}),
      ...(opts.axisFormat !== undefined ? { axisFormat: opts.axisFormat } : {}),
      ...(opts.tickInterval !== undefined ? { tickInterval: opts.tickInterval } : {}),
      ...(opts.excludes !== undefined ? { excludes: opts.excludes } : {}),
      ...(opts.weekend !== undefined ? { weekend: opts.weekend } : {}),
      ...(opts.todayMarker !== undefined ? { todayMarker: opts.todayMarker } : {}),
      ...(opts.inclusiveEndDates === true ? { inclusiveEndDates: true } : {}),
      sections: sections.map((s): GanttSection => ({ id: s.id, name: s.name, tasks: [...s.tasks] })),
    },
  };
}

type TaskMeta = Pick<GanttTask, "tags" | "start" | "end"> & { readonly taskId?: string };

/**
 * `[tags…,] [id,] [start,] end` — mermaid decides by arity after the leading
 * tags are consumed: 1 field = end only (start follows the previous task),
 * 2 = start + end, 3 = id + start + end. An id is therefore only recognized
 * with three remaining fields.
 */
export function parseTaskMeta(meta: string): TaskMeta | string {
  const fields = meta.split(",").map((f) => f.trim());
  const tags: GanttTag[] = [];
  // tags are only consumed from the front, repeatedly (mermaid's getTaskTags)
  while (fields.length > 0 && TAGS.includes(fields[0]!)) {
    const tag = fields.shift() as GanttTag;
    if (!tags.includes(tag)) tags.push(tag);
  }
  const rest = fields.filter((f) => f !== "");
  if (rest.length === 0) return "task metadata needs at least an end date or duration";
  if (rest.length > 3) return `too many task metadata fields: ${meta}`;

  const taskId = rest.length === 3 ? rest[0] : undefined;
  const startField = rest.length >= 2 ? rest[rest.length - 2] : undefined;
  const endField = rest[rest.length - 1]!;

  const start: GanttTaskStart =
    startField === undefined
      ? { kind: "prev" }
      : startField.startsWith("after ")
        ? { kind: "after", ids: startField.slice("after ".length).trim().split(/\s+/) }
        : { kind: "date", value: startField };

  const end: GanttTaskEnd = endField.startsWith("until ")
    ? { kind: "until", ids: endField.slice("until ".length).trim().split(/\s+/) }
    : DURATION_RE.test(endField)
      ? { kind: "duration", value: endField }
      : { kind: "date", value: endField };

  return { tags, ...(taskId !== undefined ? { taskId } : {}), start, end };
}
