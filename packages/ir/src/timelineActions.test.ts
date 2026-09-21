import { describe, expect, it } from "vitest";
import type { EventId, PeriodId, SectionId } from "./ids";
import type { TimelineIR } from "./timeline";
import { periodOfEvent, sectionOfPeriod } from "./timeline";
import { applyTimelineAction, timelineTextRejection } from "./timelineActions";

const S = (s: string) => s as SectionId;
const P = (s: string) => s as PeriodId;
const E = (s: string) => s as EventId;

const base: TimelineIR = {
  kind: "timeline",
  title: "Social media",
  sections: [
    {
      id: S("s1"),
      name: "",
      periods: [
        { id: P("p1"), label: "2002", events: [{ id: E("e1"), text: "LinkedIn" }] },
        { id: P("p2"), label: "2004", events: [{ id: E("e2"), text: "Facebook" }, { id: E("e3"), text: "Google" }] },
      ],
    },
    { id: S("s2"), name: "Later", periods: [] },
  ],
};

describe("applyTimelineAction", () => {
  it("refuses `:` and empty text everywhere, identity on rejection", () => {
    expect(timelineTextRejection("a : b")).toMatch(/:/);
    expect(timelineTextRejection("  ")).toMatch(/empty/);
    expect(timelineTextRejection("2004")).toBeUndefined();
    expect(applyTimelineAction(base, { type: "updatePeriod", id: P("p1"), label: "a:b" })).toBe(base);
    expect(applyTimelineAction(base, { type: "updateEvent", id: E("e1"), text: "" })).toBe(base);
    expect(applyTimelineAction(base, { type: "updateSection", id: S("s2"), name: "x:y" })).toBe(base);
  });

  it("only the first section may be unnamed", () => {
    expect(applyTimelineAction(base, { type: "addSection", section: { id: S("s3"), name: "", periods: [] } })).toBe(base);
    const fresh = applyTimelineAction({ kind: "timeline", sections: [] }, {
      type: "addSection",
      section: { id: S("s0"), name: "", periods: [] },
    });
    expect(fresh.sections).toHaveLength(1);
  });

  it("setTitle drops an emptied title, identity on no-op", () => {
    const cleared = applyTimelineAction(base, { type: "setTitle", title: "  " });
    expect("title" in cleared).toBe(false);
    expect(applyTimelineAction(base, { type: "setTitle", title: "Social media" })).toBe(base);
  });

  it("adds periods and events into the named container", () => {
    const withPeriod = applyTimelineAction(base, {
      type: "addPeriod",
      sectionId: S("s2"),
      period: { id: P("p9"), label: "2030", events: [] },
    });
    expect(sectionOfPeriod(withPeriod, P("p9"))?.id).toBe("s2");
    const withEvent = applyTimelineAction(withPeriod, {
      type: "addEvent",
      periodId: P("p9"),
      event: { id: E("e9"), text: "Something" },
    });
    expect(periodOfEvent(withEvent, E("e9"))?.id).toBe("p9");
    // unknown containers are rejected
    expect(applyTimelineAction(base, { type: "addPeriod", sectionId: S("zz"), period: { id: P("p8"), label: "x", events: [] } })).toBe(base);
    expect(applyTimelineAction(base, { type: "addEvent", periodId: P("zz"), event: { id: E("e8"), text: "x" } })).toBe(base);
  });

  it("moves periods within their section and events within their period", () => {
    const moved = applyTimelineAction(base, { type: "movePeriod", id: P("p2"), delta: -1 });
    expect(moved.sections[0]!.periods.map((p) => p.id)).toEqual(["p2", "p1"]);
    // at the edge the move is a no-op, not a wrap
    expect(applyTimelineAction(base, { type: "movePeriod", id: P("p1"), delta: -1 })).toBe(base);
    const down = applyTimelineAction(base, { type: "moveEvent", id: E("e2"), delta: 1 });
    expect(down.sections[0]!.periods[1]!.events.map((e) => e.id)).toEqual(["e3", "e2"]);
    expect(applyTimelineAction(base, { type: "moveEvent", id: E("e3"), delta: 1 })).toBe(base);
  });

  it("removing a section takes its periods and events with it", () => {
    const next = applyTimelineAction(base, { type: "removeSection", id: S("s1") });
    expect(next.sections.map((s) => s.id)).toEqual(["s2"]);
    expect(periodOfEvent(next, E("e1"))).toBeUndefined();
    const noPeriod = applyTimelineAction(base, { type: "removePeriod", id: P("p2") });
    expect(noPeriod.sections[0]!.periods.map((p) => p.id)).toEqual(["p1"]);
    const noEvent = applyTimelineAction(base, { type: "removeEvent", id: E("e2") });
    expect(noEvent.sections[0]!.periods[1]!.events.map((e) => e.id)).toEqual(["e3"]);
    expect(applyTimelineAction(base, { type: "removeEvent", id: E("zz") })).toBe(base);
  });
});
