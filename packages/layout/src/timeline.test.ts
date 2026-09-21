import { describe, expect, it } from "vitest";
import type { EventId, PeriodId, SectionId, TimelineIR } from "@gmermaid/ir";
import { fixedWidthMeasurer } from "./measurer";
import { layoutTimeline } from "./timeline";

const S = (s: string) => s as SectionId;
const P = (s: string) => s as PeriodId;
const E = (s: string) => s as EventId;

const ir: TimelineIR = {
  kind: "timeline",
  title: "History of Social Media Platform",
  sections: [
    {
      id: S("s1"),
      name: "Early",
      periods: [
        { id: P("p1"), label: "2002", events: [{ id: E("e1"), text: "LinkedIn" }] },
        { id: P("p2"), label: "2004", events: [{ id: E("e2"), text: "Facebook" }, { id: E("e3"), text: "Google" }] },
      ],
    },
    { id: S("s2"), name: "Later", periods: [{ id: P("p3"), label: "2006", events: [] }] },
  ],
};

describe("layoutTimeline", () => {
  it("matches the committed golden layout", () => {
    expect(layoutTimeline(ir, fixedWidthMeasurer())).toMatchSnapshot();
  });

  it("puts periods in columns left to right with their events stacked below the axis", () => {
    const result = layoutTimeline(ir, fixedWidthMeasurer());
    const [p1, p2, p3] = result.periods;
    expect(p1!.rect.x).toBeLessThan(p2!.rect.x);
    expect(p2!.rect.x).toBeLessThan(p3!.rect.x);
    // every period box is centred on the single axis line
    for (const p of result.periods) expect(p.rect.y + p.rect.h / 2).toBeCloseTo(result.axis.y);
    // the two events of 2004 stack under their own column, not beside it
    const [e2, e3] = result.events.filter((e) => e.id === "e2" || e.id === "e3");
    expect(e2!.rect.x).toBe(p2!.rect.x);
    expect(e3!.rect.x).toBe(p2!.rect.x);
    expect(e3!.rect.y).toBeGreaterThan(e2!.rect.y + e2!.rect.h);
    expect(e2!.rect.y).toBeGreaterThan(result.axis.y);
  });

  it("bands each section across its own periods, above the axis, with its colour", () => {
    const result = layoutTimeline(ir, fixedWidthMeasurer());
    const [early, later] = result.sections;
    expect(early!.rect.y + early!.rect.h).toBeLessThanOrEqual(result.axis.y);
    // the band covers both of its periods and stops before the next section
    expect(early!.rect.x).toBeLessThanOrEqual(result.periods[0]!.rect.x);
    expect(early!.rect.x + early!.rect.w).toBeGreaterThanOrEqual(
      result.periods[1]!.rect.x + result.periods[1]!.rect.w,
    );
    expect(later!.rect.x).toBeGreaterThan(early!.rect.x + early!.rect.w);
    // periods and events inherit their section's colour index
    expect(result.periods.map((p) => p.colorIndex)).toEqual([0, 0, 1]);
    expect(result.events.every((e) => e.colorIndex === 0)).toBe(true);
  });

  it("gives an empty section a visible slot of its own", () => {
    const withEmpty = layoutTimeline(
      { kind: "timeline", sections: [{ id: S("s1"), name: "Nothing yet", periods: [] }] },
      fixedWidthMeasurer(),
    );
    expect(withEmpty.sections[0]!.rect.w).toBeGreaterThan(0);
    expect(withEmpty.periods).toEqual([]);
  });

  it("returns finite sizes for an empty timeline and pure JSON data", () => {
    const empty = layoutTimeline({ kind: "timeline", sections: [] }, fixedWidthMeasurer());
    expect(Number.isFinite(empty.size.w)).toBe(true);
    expect(Number.isFinite(empty.size.h)).toBe(true);
    const result = layoutTimeline(ir, fixedWidthMeasurer());
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
