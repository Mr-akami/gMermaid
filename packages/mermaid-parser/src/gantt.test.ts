import { describe, expect, it } from "vitest";
import { ganttToMermaid } from "@gmermaid/mermaid-codegen";
import { applyGanttAction, emptyGantt, type GanttIR, type SectionId, type TaskId } from "@gmermaid/ir";
import { parseGantt, parseTaskMeta } from "./gantt";

// https://mermaid.js.org/syntax/gantt.html
const DOCS_SAMPLE = `gantt
    title A Gantt Diagram
    dateFormat YYYY-MM-DD
    section Section
        A task          :a1, 2014-01-01, 30d
        Another task    :after a1, 20d
    section Another
        Task in Another :2014-01-12, 12d
        another task    :24d
`;

function roundTrip(code: string) {
  const first = parseGantt(code);
  expect(first.ok).toBe(true);
  if (!first.ok) throw new Error(first.errors.map((e) => e.message).join("; "));
  const regen = ganttToMermaid(first.ir);
  const back = parseGantt(regen);
  expect(back.ok).toBe(true);
  if (!back.ok) throw new Error(back.errors.map((e) => e.message).join("; "));
  expect(back.ir).toEqual(first.ir);
  expect(ganttToMermaid(back.ir)).toBe(regen);
  return first.ir;
}

describe("parseGantt", () => {
  it("parses the docs sample and round trips through codegen", () => {
    const ir = roundTrip(DOCS_SAMPLE);
    expect(ir.title).toBe("A Gantt Diagram");
    expect(ir.dateFormat).toBe("YYYY-MM-DD");
    expect(ir.sections.map((s) => s.name)).toEqual(["Section", "Another"]);
    expect(ir.sections[0]!.tasks[0]).toMatchObject({
      name: "A task",
      taskId: "a1",
      tags: [],
      start: { kind: "date", value: "2014-01-01" },
      end: { kind: "duration", value: "30d" },
    });
    expect(ir.sections[0]!.tasks[1]!.start).toEqual({ kind: "after", ids: ["a1"] });
    expect(ir.sections[1]!.tasks[1]!.start).toEqual({ kind: "prev" });
    expect(ir.sections[1]!.tasks[1]!.end).toEqual({ kind: "duration", value: "24d" });
  });

  it("reads every diagram-level setting, merging repeated excludes", () => {
    const ir = roundTrip(`gantt
  dateFormat DD-MM-YYYY
  axisFormat %d/%m
  tickInterval 1week
  excludes weekends
  %% week 7 is winter break
  excludes 10-02-2025 11-02-2025
  weekend friday
  todayMarker off
  inclusiveEndDates
  section S
  A :2014-01-01, 1d
`);
    expect(ir.axisFormat).toBe("%d/%m");
    expect(ir.tickInterval).toBe("1week");
    expect(ir.excludes).toEqual(["weekends", "10-02-2025", "11-02-2025"]);
    expect(ir.weekend).toBe("friday");
    expect(ir.todayMarker).toBe("off");
    expect(ir.inclusiveEndDates).toBe(true);
  });

  it("puts tasks written before any section into an unnamed leading section", () => {
    const ir = roundTrip(`gantt
  apple :a, 2017-07-20, 1w
  banana :crit, b, 2017-07-23, 1d
  section Fruit
  cherry :active, c, after b a, 1d
`);
    expect(ir.sections.map((s) => [s.name, s.tasks.length])).toEqual([
      ["", 2],
      ["Fruit", 1],
    ]);
    expect(ir.sections[1]!.tasks[0]!.start).toEqual({ kind: "after", ids: ["b", "a"] });
    expect(ir.sections[1]!.tasks[0]!.tags).toEqual(["active"]);
  });

  it("tolerates frontmatter, directives, comments, `;` and dropped statements", () => {
    const ir = roundTrip(`---
displayMode: compact
---
%%{init: {'theme':'dark'}}%%
gantt
  %% a comment
  dateFormat YYYY-MM-DD;
  topAxis
  weekday monday
  includes 2014-01-11
  accTitle: a chart
  section S
  A :a1, 2014-01-01, 1d
  click a1 href "https://example.com"
`);
    expect(ir.dateFormat).toBe("YYYY-MM-DD");
    expect(ir.sections[0]!.tasks).toHaveLength(1);
  });

  it("reports the header and unparseable lines", () => {
    const wrong = parseGantt("flowchart TD\n  a --> b\n");
    expect(wrong.ok).toBe(false);
    if (wrong.ok) return;
    expect(wrong.errors[0]!.message).toMatch(/gantt/);

    const bad = parseGantt("gantt\n  section S\n  nonsense\n");
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors[0]).toEqual({ line: 3, message: "cannot parse: nonsense" });
  });
});

describe("parseTaskMeta", () => {
  it("applies mermaid's arity rules: 1 = end, 2 = start + end, 3 = id + start + end", () => {
    expect(parseTaskMeta("24d")).toEqual({ tags: [], start: { kind: "prev" }, end: { kind: "duration", value: "24d" } });
    expect(parseTaskMeta("2014-01-12, 12d")).toEqual({
      tags: [],
      start: { kind: "date", value: "2014-01-12" },
      end: { kind: "duration", value: "12d" },
    });
    expect(parseTaskMeta("des1, 2014-01-06, 2014-01-08")).toEqual({
      tags: [],
      taskId: "des1",
      start: { kind: "date", value: "2014-01-06" },
      end: { kind: "date", value: "2014-01-08" },
    });
  });

  it("consumes tags only from the front, so a 2-field line has no id", () => {
    expect(parseTaskMeta("crit, done, after des1, 2d")).toEqual({
      tags: ["crit", "done"],
      start: { kind: "after", ids: ["des1"] },
      end: { kind: "duration", value: "2d" },
    });
    // `des3` here is a START (2 fields), not an id
    expect(parseTaskMeta("des3, 5d")).toEqual({
      tags: [],
      start: { kind: "date", value: "des3" },
      end: { kind: "duration", value: "5d" },
    });
  });

  it("reads `until`, milestones and multi-id references", () => {
    expect(parseTaskMeta("until isadded")).toEqual({ tags: [], start: { kind: "prev" }, end: { kind: "until", ids: ["isadded"] } });
    expect(parseTaskMeta("milestone, isadded, 2014-01-25, 0d")).toEqual({
      tags: ["milestone"],
      taskId: "isadded",
      start: { kind: "date", value: "2014-01-25" },
      end: { kind: "duration", value: "0d" },
    });
    expect(parseTaskMeta("d, 2017-07-20, until b c")).toEqual({
      tags: [],
      taskId: "d",
      start: { kind: "date", value: "2017-07-20" },
      end: { kind: "until", ids: ["b", "c"] },
    });
  });

  it("rejects empty and over-long metadata", () => {
    expect(typeof parseTaskMeta("")).toBe("string");
    expect(typeof parseTaskMeta("a, b, c, d")).toBe("string");
  });

  it("hostile option and task text the reducer accepts survives emit → parse", () => {
    let ir: GanttIR = emptyGantt();
    ir = applyGanttAction(ir, {
      type: "setGanttOptions",
      patch: { title: "100%% done\nreally", dateFormat: "YYYY-MM-DD", excludes: ["weekends, 2024-01-01", ""] },
    });
    expect(ir.title).toBe("100 done really");
    expect(ir.excludes).toEqual(["weekends", "2024-01-01"]);
    ir = applyGanttAction(ir, { type: "addSection", section: { id: "section-1" as SectionId, name: "Phase: one" } });
    ir = applyGanttAction(ir, {
      type: "addTask",
      sectionId: "section-1" as SectionId,
      task: { id: "task-1" as TaskId, name: "50% done: ship it", tags: [], start: { kind: "date", value: "2024-01-01" }, end: { kind: "duration", value: "3d" } },
    });
    const back = parseGantt(ganttToMermaid(ir));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.ir).toEqual(ir);
  });

  it("refuses the task names and nameless sections the text cannot carry", () => {
    let ir: GanttIR = emptyGantt();
    ir = applyGanttAction(ir, { type: "addSection", section: { id: "section-1" as SectionId, name: "" } });
    ir = applyGanttAction(ir, { type: "addSection", section: { id: "section-2" as SectionId, name: "Later" } });
    const task = { id: "task-1" as TaskId, tags: [], start: { kind: "prev" as const }, end: { kind: "duration" as const, value: "1d" } };
    // a nameless task emits a line starting with `:`; a keyword-led one is
    // read as that statement and takes the task with it
    for (const name of ["", "   ", "title Plan", "section Two", "weekend friday"]) {
      expect(applyGanttAction(ir, { type: "addTask", sectionId: "section-2" as SectionId, task: { ...task, name } }), name).toBe(ir);
    }
    ir = applyGanttAction(ir, { type: "addTask", sectionId: "section-2" as SectionId, task: { ...task, name: "Work" } });
    // a section with no header only exists first, so it can be neither
    // renamed away nor moved down
    expect(applyGanttAction(ir, { type: "updateSection", id: "section-2" as SectionId, name: "" })).toBe(ir);
    expect(applyGanttAction(ir, { type: "moveSection", id: "section-1" as SectionId, delta: 1 })).toBe(ir);
  });
});
