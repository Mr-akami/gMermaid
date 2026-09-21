import type { EventId, PeriodId, SectionId, TimelineIR } from "@gmermaid/ir";
import type { TextMeasurer, TextStyle } from "./measurer";
import type { Point, Rect } from "./result";

// Timelines are a plain left-to-right sequence, so this layout is arithmetic
// only — no dagre. Columns run left to right in IR order; each column holds a
// period box centred on the horizontal axis and its events stacked below it.
// Section bands span the columns of their periods, above the axis.

const TITLE_STYLE: TextStyle = { fontSize: 18, fontFamily: "sans-serif", bold: true };
const SECTION_STYLE: TextStyle = { fontSize: 14, fontFamily: "sans-serif", bold: true };
const PERIOD_STYLE: TextStyle = { fontSize: 14, fontFamily: "sans-serif", bold: true };
const EVENT_STYLE: TextStyle = { fontSize: 12, fontFamily: "sans-serif" };

const PAD_X = 14;
const PAD_Y = 8;
const MIN_COL_W = 90;
const COL_GAP = 16;
const TITLE_H = 40;
const SECTION_H = 30;
const SECTION_GAP = 10;
const PERIOD_H = 34;
const EVENT_GAP = 10;
const MIN_EVENT_H = 30;
/** Axis overhang past the first/last column, so the line reads as an axis. */
const AXIS_OVERHANG = 10;

export interface TimelineSectionBand {
  readonly id: SectionId;
  readonly name: string;
  readonly rect: Rect;
  /** Section index — the renderer turns it into one of a fixed palette. */
  readonly colorIndex: number;
}

export interface TimelinePeriodBox {
  readonly id: PeriodId;
  readonly label: string;
  readonly rect: Rect;
  readonly colorIndex: number;
}

export interface TimelineEventBox {
  readonly id: EventId;
  readonly text: string;
  readonly rect: Rect;
  readonly colorIndex: number;
}

export interface TimelineLayout {
  readonly kind: "timeline";
  readonly size: { readonly w: number; readonly h: number };
  readonly title?: string;
  readonly titlePos?: Point;
  /** The horizontal axis every period box sits on. */
  readonly axis: { readonly y: number; readonly x1: number; readonly x2: number };
  readonly sections: readonly TimelineSectionBand[];
  readonly periods: readonly TimelinePeriodBox[];
  readonly events: readonly TimelineEventBox[];
}

/** `<br>` became a newline on import: measure the widest line, stack the rest. */
function measureBlock(measure: TextMeasurer, text: string, style: TextStyle): { w: number; h: number } {
  const rows = text.split("\n");
  let w = 0;
  for (const row of rows) w = Math.max(w, measure.measure(row, style).w);
  return { w, h: measure.measure("x", style).h * rows.length };
}

export function layoutTimeline(ir: TimelineIR, measure: TextMeasurer): TimelineLayout {
  const hasTitle = ir.title !== undefined;
  const named = ir.sections.some((s) => s.name !== "");
  const bandTop = hasTitle ? TITLE_H : 0;
  const axisY = bandTop + (named ? SECTION_H + SECTION_GAP : 0) + PERIOD_H / 2;

  const sections: TimelineSectionBand[] = [];
  const periods: TimelinePeriodBox[] = [];
  const events: TimelineEventBox[] = [];

  let x = 0;
  let maxBottom = axisY + PERIOD_H / 2;

  ir.sections.forEach((section, colorIndex) => {
    const bandStart = x;

    for (const period of section.periods) {
      const label = measureBlock(measure, period.label, PERIOD_STYLE);
      const sized = period.events.map((e) => ({ e, m: measureBlock(measure, e.text, EVENT_STYLE) }));
      const colW = Math.max(MIN_COL_W, label.w + PAD_X * 2, ...sized.map((s) => s.m.w + PAD_X * 2));

      periods.push({
        id: period.id,
        label: period.label,
        rect: { x, y: axisY - PERIOD_H / 2, w: colW, h: PERIOD_H },
        colorIndex,
      });

      let y = axisY + PERIOD_H / 2 + EVENT_GAP;
      for (const { e, m } of sized) {
        const h = Math.max(MIN_EVENT_H, m.h + PAD_Y * 2);
        events.push({ id: e.id, text: e.text, rect: { x, y, w: colW, h }, colorIndex });
        y += h + EVENT_GAP;
      }
      maxBottom = Math.max(maxBottom, y);
      x += colW + COL_GAP;
    }

    // an empty section still needs a slot: it is the drop target for the
    // next "+ Period", so it has to stay visible and clickable
    if (section.periods.length === 0) {
      x += Math.max(MIN_COL_W, measureBlock(measure, section.name, SECTION_STYLE).w + PAD_X * 2) + COL_GAP;
    }

    if (section.name !== "") {
      sections.push({
        id: section.id,
        name: section.name,
        rect: { x: bandStart, y: bandTop, w: Math.max(MIN_COL_W, x - COL_GAP - bandStart), h: SECTION_H },
        colorIndex,
      });
    }
  });

  const contentW = Math.max(x - COL_GAP, MIN_COL_W);
  const axis = { y: axisY, x1: -AXIS_OVERHANG, x2: contentW + AXIS_OVERHANG };

  let w = axis.x2;
  if (hasTitle) w = Math.max(w, measureBlock(measure, ir.title!, TITLE_STYLE).w);

  return {
    kind: "timeline",
    size: { w, h: Math.max(maxBottom, axisY + PERIOD_H / 2) },
    ...(hasTitle ? { title: ir.title!, titlePos: { x: contentW / 2, y: TITLE_H / 2 } } : {}),
    axis,
    sections,
    periods,
    events,
  };
}
