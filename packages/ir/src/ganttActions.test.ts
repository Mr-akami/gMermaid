import { describe, expect, it } from "vitest";
import type { SectionId, TaskId } from "./ids";
import type { GanttIR } from "./gantt";
import { applyGanttAction, sanitizeGanttName } from "./ganttActions";

const S = (s: string) => s as SectionId;
const T = (s: string) => s as TaskId;

const base: GanttIR = {
  kind: "gantt",
  dateFormat: "YYYY-MM-DD",
  sections: [
    {
      id: S("s1"),
      name: "Section",
      tasks: [
        { id: T("t1"), name: "A task", taskId: "a1", tags: [], start: { kind: "date", value: "2014-01-01" }, end: { kind: "duration", value: "30d" } },
        { id: T("t2"), name: "Another task", tags: [], start: { kind: "after", ids: ["a1"] }, end: { kind: "duration", value: "20d" } },
      ],
    },
    { id: S("s2"), name: "Another", tasks: [] },
  ],
};

describe("applyGanttAction", () => {
  it("adds a task to the named section and keeps text order", () => {
    const next = applyGanttAction(base, {
      type: "addTask",
      sectionId: S("s2"),
      task: { id: T("t3"), name: "Third", tags: [], start: { kind: "prev" }, end: { kind: "duration", value: "1d" } },
    });
    expect(next.sections[1]!.tasks.map((t) => t.id)).toEqual(["t3"]);
    expect(next.sections[0]).toBe(base.sections[0]);
  });

  it("rejects a duplicate task id and an unknown section", () => {
    const dup = applyGanttAction(base, {
      type: "addTask",
      sectionId: S("s2"),
      task: { id: T("t1"), name: "dup", tags: [], start: { kind: "prev" }, end: { kind: "duration", value: "1d" } },
    });
    expect(dup).toBe(base);
    const missing = applyGanttAction(base, {
      type: "addTask",
      sectionId: S("nope"),
      task: { id: T("t9"), name: "x", tags: [], start: { kind: "prev" }, end: { kind: "duration", value: "1d" } },
    });
    expect(missing).toBe(base);
  });

  it("drops an id that mermaid could not read back (no explicit start)", () => {
    const next = applyGanttAction(base, { type: "updateTask", id: T("t1"), patch: { start: { kind: "prev" } } });
    expect(next.sections[0]!.tasks[0]!.taskId).toBeUndefined();
  });

  it("sanitizes names that would break the task line, and dedupes tags", () => {
    const next = applyGanttAction(base, {
      type: "updateTask",
      id: T("t2"),
      patch: { name: "Write:  the #docs;", tags: ["crit", "crit", "done"] },
    });
    expect(next.sections[0]!.tasks[1]!.name).toBe("Write the docs");
    expect(next.sections[0]!.tasks[1]!.tags).toEqual(["crit", "done"]);
    expect(sanitizeGanttName("a %% b")).toBe("a b");
  });

  it("moveTask swaps within its section and clamps at the ends", () => {
    const moved = applyGanttAction(base, { type: "moveTask", id: T("t2"), delta: -1 });
    expect(moved.sections[0]!.tasks.map((t) => t.id)).toEqual(["t2", "t1"]);
    expect(applyGanttAction(base, { type: "moveTask", id: T("t1"), delta: -1 })).toBe(base);
    expect(applyGanttAction(base, { type: "moveTask", id: T("t2"), delta: 1 })).toBe(base);
  });

  it("moveSection reorders sections and removeSection takes its tasks with it", () => {
    expect(applyGanttAction(base, { type: "moveSection", id: S("s2"), delta: -1 }).sections.map((s) => s.id)).toEqual(["s2", "s1"]);
    const removed = applyGanttAction(base, { type: "removeSection", id: S("s1") });
    expect(removed.sections.map((s) => s.id)).toEqual(["s2"]);
  });

  it("only the leading section may be nameless", () => {
    expect(applyGanttAction(base, { type: "addSection", section: { id: S("s3"), name: "  " } })).toBe(base);
    const empty: GanttIR = { kind: "gantt", sections: [] };
    expect(applyGanttAction(empty, { type: "addSection", section: { id: S("s0"), name: "" } }).sections).toHaveLength(1);
  });

  it("setGanttOptions patches only the named keys and clears with an empty value", () => {
    const titled = applyGanttAction(base, { type: "setGanttOptions", patch: { title: "Plan" } });
    expect(titled.title).toBe("Plan");
    expect(titled.dateFormat).toBe("YYYY-MM-DD");
    const cleared = applyGanttAction(titled, { type: "setGanttOptions", patch: { title: "  " } });
    expect("title" in cleared).toBe(false);
    // identity on a no-op keeps memoized layout/codegen alive
    expect(applyGanttAction(base, { type: "setGanttOptions", patch: { dateFormat: "YYYY-MM-DD" } })).toBe(base);
  });

  it("keeps reference lists id-safe", () => {
    const next = applyGanttAction(base, {
      type: "updateTask",
      id: T("t2"),
      patch: { start: { kind: "after", ids: [" a1 ", "bad id", "b2"] } },
    });
    expect(next.sections[0]!.tasks[1]!.start).toEqual({ kind: "after", ids: ["a1", "b2"] });
  });
});
