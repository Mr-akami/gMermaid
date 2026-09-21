import { describe, expect, it } from "vitest";
import type { SectionId, TaskId } from "./ids";
import type { JourneyIR } from "./journey";
import { applyJourneyAction } from "./journeyActions";

const S = (s: string) => s as SectionId;
const T = (s: string) => s as TaskId;

const ir: JourneyIR = {
  kind: "journey",
  title: "Day",
  sections: [
    {
      id: S("s1"),
      name: "Work",
      tasks: [
        { id: T("t1"), name: "Tea", score: 5, actors: ["Me"] },
        { id: T("t2"), name: "Code", score: 2, actors: ["Me", "Cat"] },
      ],
    },
    { id: S("s2"), name: "Home", tasks: [{ id: T("t3"), name: "Sit", score: 4, actors: ["Me"] }] },
  ],
};

describe("applyJourneyAction", () => {
  it("adds and updates tasks, sanitizing structural characters", () => {
    const added = applyJourneyAction(ir, {
      type: "addTask",
      sectionId: S("s1"),
      task: { id: T("t4"), name: "Lunch: at #1;", score: 3, actors: ["A, B", "  ", "A B"] },
      afterTaskId: T("t1"),
    });
    expect(added.sections[0]!.tasks.map((t) => t.id)).toEqual(["t1", "t4", "t2"]);
    expect(added.sections[0]!.tasks[1]).toEqual({ id: "t4", name: "Lunch at 1", score: 3, actors: ["A B"] });
    const updated = applyJourneyAction(added, { type: "updateTask", id: T("t4"), score: 1, actors: ["X"] });
    expect(updated.sections[0]!.tasks[1]).toEqual({ id: "t4", name: "Lunch at 1", score: 1, actors: ["X"] });
    // no-ops keep identity
    expect(applyJourneyAction(updated, { type: "updateTask", id: T("t4"), score: 1 })).toBe(updated);
    expect(
      applyJourneyAction(ir, { type: "addTask", sectionId: S("nope"), task: { id: T("x"), name: "x", score: 1, actors: [] } }),
    ).toBe(ir);
    expect(applyJourneyAction(ir, { type: "updateTask", id: T("t1"), name: "" })).toBe(ir);
  });

  it("moves tasks within and across sections", () => {
    const down = applyJourneyAction(ir, { type: "moveTask", id: T("t1"), delta: 1 });
    expect(down.sections[0]!.tasks.map((t) => t.id)).toEqual(["t2", "t1"]);
    const hop = applyJourneyAction(down, { type: "moveTask", id: T("t1"), delta: 1 });
    expect(hop.sections[0]!.tasks.map((t) => t.id)).toEqual(["t2"]);
    expect(hop.sections[1]!.tasks.map((t) => t.id)).toEqual(["t1", "t3"]);
    expect(applyJourneyAction(ir, { type: "moveTask", id: T("t1"), delta: -1 })).toBe(ir);
  });

  it("manages sections: add, rename, reorder, remove; the unnamed section stays first", () => {
    const added = applyJourneyAction(ir, { type: "addSection", section: { id: S("s3"), name: "Night" } });
    expect(added.sections.map((s) => s.name)).toEqual(["Work", "Home", "Night"]);
    expect(applyJourneyAction(added, { type: "addSection", section: { id: S("s4"), name: "" } })).toBe(added);
    const moved = applyJourneyAction(added, { type: "moveSection", id: S("s3"), delta: -1 });
    expect(moved.sections.map((s) => s.name)).toEqual(["Work", "Night", "Home"]);
    expect(applyJourneyAction(moved, { type: "moveSection", id: S("s1"), delta: -1 })).toBe(moved);
    const renamed = applyJourneyAction(moved, { type: "updateSection", id: S("s1"), name: "" });
    expect(renamed.sections[0]!.name).toBe("");
    expect(applyJourneyAction(renamed, { type: "moveSection", id: S("s1"), delta: 1 })).toBe(renamed);
    expect(applyJourneyAction(renamed, { type: "updateSection", id: S("s3"), name: "" })).toBe(renamed);
    const removed = applyJourneyAction(renamed, { type: "removeSection", id: S("s2") });
    expect(removed.sections.map((s) => s.id)).toEqual(["s1", "s3"]);
  });

  it("sets and clears the title", () => {
    const cleared = applyJourneyAction(ir, { type: "setJourneyTitle", title: "  " });
    expect("title" in cleared).toBe(false);
    expect(applyJourneyAction(cleared, { type: "setJourneyTitle", title: "" })).toBe(cleared);
    expect(applyJourneyAction(cleared, { type: "setJourneyTitle", title: "A: b" }).title).toBe("A b");
  });
});
