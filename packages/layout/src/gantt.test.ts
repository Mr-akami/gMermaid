import { describe, expect, it } from "vitest";
import type { GanttIR, SectionId, TaskId } from "@gmermaid/ir";
import { fixedWidthMeasurer } from "./measurer";
import { layoutGantt } from "./gantt";
import { chooseTickStep, formatGanttDate, parseGanttDate, parseGanttDuration, parseTickInterval } from "./ganttTime";

const S = (s: string) => s as SectionId;
const T = (s: string) => s as TaskId;

const utc = (text: string) => Date.parse(`${text}Z`);

// the docs sample: https://mermaid.js.org/syntax/gantt.html
const ir: GanttIR = {
  kind: "gantt",
  title: "A Gantt Diagram",
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
    {
      id: S("s2"),
      name: "Another",
      tasks: [
        { id: T("t3"), name: "Task in Another", tags: [], start: { kind: "date", value: "2014-01-12" }, end: { kind: "duration", value: "12d" } },
        { id: T("t4"), name: "another task", tags: [], start: { kind: "prev" }, end: { kind: "duration", value: "24d" } },
      ],
    },
  ],
};

// a fixed "now" keeps the today marker out of the golden layout's way
const NEVER = utc("1999-01-01T00:00:00");

describe("layoutGantt", () => {
  it("matches the committed golden layout", () => {
    expect(layoutGantt(ir, fixedWidthMeasurer(), NEVER)).toMatchSnapshot();
  });

  it("places bars on the resolved time axis, one row each", () => {
    const result = layoutGantt(ir, fixedWidthMeasurer(), NEVER);
    expect(result.bars.map((b) => b.id)).toEqual(["t1", "t2", "t3", "t4"]);
    const [t1, t2, t3, t4] = result.bars;
    // `after a1` starts exactly where a1 ends
    expect(t2!.rect.x).toBeCloseTo(t1!.rect.x + t1!.rect.w, 6);
    // a "prev" start follows the previous task in text order, across sections
    expect(t4!.rect.x).toBeCloseTo(t3!.rect.x + t3!.rect.w, 6);
    // 30d against 20d, on one shared scale
    expect(t1!.rect.w).toBeGreaterThan(t2!.rect.w);
    expect(new Set(result.bars.map((b) => b.rect.y)).size).toBe(4);
    expect(result.bars.every((b) => !b.unresolved)).toBe(true);
    // the first bar opens the domain, the last one closes it
    expect(t1!.rect.x).toBeCloseTo(result.chartX, 6);
    expect(t2!.rect.x + t2!.rect.w).toBeCloseTo(result.chartX + result.chartW, 6);
  });

  it("bands each section across its own rows and labels the axis", () => {
    const result = layoutGantt(ir, fixedWidthMeasurer(), NEVER);
    const [first, second] = result.sections;
    expect(first!.name).toBe("Section");
    expect(first!.rect.y).toBeLessThan(second!.rect.y);
    expect(first!.rect.y + first!.rect.h).toBeLessThanOrEqual(second!.rect.y);
    expect(result.ticks.length).toBeGreaterThan(1);
    expect(result.ticks[0]!.label).toMatch(/^2014-01-\d\d$/);
    expect(result.title).toBe("A Gantt Diagram");
  });

  it("honours tickInterval and axisFormat", () => {
    const result = layoutGantt({ ...ir, tickInterval: "1week", axisFormat: "%d/%m" }, fixedWidthMeasurer(), NEVER);
    expect(result.ticks[0]!.label).toMatch(/^\d\d\/01$/);
    const gaps = result.ticks.slice(1).map((t, i) => t.x - result.ticks[i]!.x);
    expect(new Set(gaps.map((g) => g.toFixed(6))).size).toBe(1);
  });

  it("draws the today marker only inside the axis, and never when off", () => {
    const inside = layoutGantt(ir, fixedWidthMeasurer(), utc("2014-01-20T00:00:00"));
    expect(inside.todayX).toBeGreaterThan(inside.chartX);
    expect(layoutGantt(ir, fixedWidthMeasurer(), NEVER).todayX).toBeUndefined();
    expect(layoutGantt({ ...ir, todayMarker: "off" }, fixedWidthMeasurer(), utc("2014-01-20T00:00:00")).todayX).toBeUndefined();
  });

  it("puts milestones at start + duration / 2 and keeps `vert` out of the rows", () => {
    const marked: GanttIR = {
      kind: "gantt",
      dateFormat: "YYYY-MM-DD",
      sections: [
        {
          id: S("s1"),
          name: "S",
          tasks: [
            { id: T("t1"), name: "A", taskId: "a", tags: [], start: { kind: "date", value: "2014-01-01" }, end: { kind: "duration", value: "10d" } },
            { id: T("t2"), name: "M", taskId: "m", tags: ["milestone"], start: { kind: "date", value: "2014-01-05" }, end: { kind: "duration", value: "2d" } },
            { id: T("t3"), name: "V", taskId: "v", tags: ["vert"], start: { kind: "date", value: "2014-01-03" }, end: { kind: "duration", value: "0d" } },
          ],
        },
      ],
    };
    const result = layoutGantt(marked, fixedWidthMeasurer(), NEVER);
    expect(result.bars.map((b) => b.id)).toEqual(["t1", "t2"]);
    expect(result.verts.map((v) => v.id)).toEqual(["t3"]);
    const day = result.chartW / 10; // the domain spans 10 days
    const milestone = result.bars[1]!;
    // 2014-01-05 + 2d/2 = 2014-01-06 = day 5 of the domain
    expect(milestone.rect.x).toBeCloseTo(result.chartX + day * 5, 6);
    expect(milestone.milestone).toBe(true);
    expect(result.verts[0]!.x).toBeCloseTo(result.chartX + day * 2, 6);
  });

  it("falls back to sequential placement and flags what it could not resolve", () => {
    const broken: GanttIR = {
      kind: "gantt",
      dateFormat: "YYYY-MM-DD",
      sections: [
        {
          id: S("s1"),
          name: "S",
          tasks: [
            { id: T("t1"), name: "ok", taskId: "a", tags: [], start: { kind: "date", value: "2014-01-01" }, end: { kind: "duration", value: "2d" } },
            { id: T("t2"), name: "bad date", tags: [], start: { kind: "date", value: "not-a-date" }, end: { kind: "duration", value: "2d" } },
            { id: T("t3"), name: "dangling", tags: [], start: { kind: "after", ids: ["nope"] }, end: { kind: "duration", value: "2d" } },
          ],
        },
      ],
    };
    const result = layoutGantt(broken, fixedWidthMeasurer(), NEVER);
    expect(result.bars.map((b) => b.unresolved)).toEqual([false, true, true]);
    // unresolved bars are still laid out, in text order, after the known one
    expect(result.bars[1]!.rect.x).toBeGreaterThanOrEqual(result.bars[0]!.rect.x);
    expect(result.bars[2]!.rect.x).toBeGreaterThanOrEqual(result.bars[1]!.rect.x);
  });

  it("resolves forward references and `until`", () => {
    const forward: GanttIR = {
      kind: "gantt",
      dateFormat: "YYYY-MM-DD",
      sections: [
        {
          id: S("s1"),
          name: "S",
          tasks: [
            { id: T("t1"), name: "until b", taskId: "a", tags: [], start: { kind: "date", value: "2014-01-01" }, end: { kind: "until", ids: ["b"] } },
            { id: T("t2"), name: "b", taskId: "b", tags: [], start: { kind: "date", value: "2014-01-06" }, end: { kind: "duration", value: "2d" } },
          ],
        },
      ],
    };
    const result = layoutGantt(forward, fixedWidthMeasurer(), NEVER);
    expect(result.bars.every((b) => !b.unresolved)).toBe(true);
    expect(result.bars[0]!.rect.x + result.bars[0]!.rect.w).toBeCloseTo(result.bars[1]!.rect.x, 6);
  });

  it("returns finite sizes for an empty chart and pure JSON data", () => {
    const empty = layoutGantt({ kind: "gantt", sections: [] }, fixedWidthMeasurer(), NEVER);
    expect(Number.isFinite(empty.size.w)).toBe(true);
    expect(Number.isFinite(empty.size.h)).toBe(true);
    const result = layoutGantt(ir, fixedWidthMeasurer(), NEVER);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe("gantt date helpers", () => {
  it("parses the dateFormat tokens in UTC, whatever the host timezone", () => {
    expect(parseGanttDate("2014-01-06", "YYYY-MM-DD")).toBe(utc("2014-01-06T00:00:00"));
    expect(parseGanttDate("06-01-2014", "DD-MM-YYYY")).toBe(utc("2014-01-06T00:00:00"));
    expect(parseGanttDate("2014-01-06 17:49", "YYYY-MM-DD HH:mm")).toBe(utc("2014-01-06T17:49:00"));
    // a time-only format has no date part: anchored at the epoch, not today
    expect(parseGanttDate("17:49", "HH:mm")).toBe(utc("1970-01-01T17:49:00"));
    expect(parseGanttDate("1410715640", "X")).toBe(1_410_715_640_000);
    expect(parseGanttDate("2014-13-06", "YYYY-MM-DD")).toBeUndefined();
    expect(parseGanttDate("nope", "YYYY-MM-DD")).toBeUndefined();
  });

  it("parses durations and tick intervals, rejecting what it cannot model", () => {
    expect(parseGanttDuration("3d")).toBe(3 * 86_400_000);
    expect(parseGanttDuration("1.5h")).toBe(5_400_000);
    expect(parseGanttDuration("500ms")).toBe(500);
    expect(parseGanttDuration("2w")).toBe(14 * 86_400_000);
    expect(parseGanttDuration("3dX")).toBeUndefined();
    expect(parseTickInterval("1week")).toBe(7 * 86_400_000);
    expect(parseTickInterval("0day")).toBeUndefined();
  });

  it("formats axis labels with d3-style directives", () => {
    const t = utc("2014-01-06T17:49:03");
    expect(formatGanttDate(t, "%Y-%m-%d")).toBe("2014-01-06");
    expect(formatGanttDate(t, "%H:%M:%S")).toBe("17:49:03");
    expect(formatGanttDate(t, "%a %b %e, %y")).toBe("Mon Jan  6, 14");
    expect(formatGanttDate(t, "100%% of %d")).toBe("100% of 06");
  });

  it("chooses a tick step that keeps the axis readable", () => {
    expect(chooseTickStep(86_400_000, 9)).toBeLessThanOrEqual(86_400_000 / 4);
    expect(chooseTickStep(365 * 86_400_000, 9)).toBeGreaterThanOrEqual(28 * 86_400_000);
  });
});
