import type { JourneyIR, SectionId, TaskId } from "@gmermaid/ir";
import { journeyActors } from "@gmermaid/ir";
import type { TextMeasurer } from "./measurer";
import type { Point, Rect } from "./result";

// A user journey is a left-to-right sequence, so it needs no graph layout at
// all: tasks are columns in source order, sections are bands spanning their
// own columns, and the score picks the row of the face marker. Everything
// here is arithmetic — no dagre, no DOM.

const TITLE_STYLE = { fontSize: 16, fontFamily: "sans-serif", bold: true } as const;
const TASK_STYLE = { fontSize: 13, fontFamily: "sans-serif" } as const;
const LEGEND_STYLE = { fontSize: 12, fontFamily: "sans-serif" } as const;

const TITLE_H = 34;
const SECTION_H = 26;
const SECTION_GAP = 10;
const TASK_PAD_X = 12;
const TASK_PAD_Y = 8;
const TASK_MIN_W = 90;
const TASK_GAP = 14;
/** A section with no tasks still needs a band wide enough to click. */
const EMPTY_SECTION_W = 110;
const ACTOR_R = 7;
const ACTOR_GAP = 4;
const ACTOR_ROW_H = 24;
/** Score rows: 5 at the top, 1 at the bottom (mermaid draws it this way). */
const SCORE_STEP = 26;
const SCORE_TOP_GAP = 14;
const FACE_R = 11;
const LEGEND_GAP = 24;
const LEGEND_SWATCH = 12;
const LEGEND_ITEM_GAP = 18;

export type JourneyMood = "sad" | "neutral" | "happy";

/** Mermaid's own thresholds: > 3 happy, < 3 sad, 3 ambivalent. */
export function moodForScore(score: number): JourneyMood {
  if (score > 3) return "happy";
  if (score < 3) return "sad";
  return "neutral";
}

export interface JourneyActorMark {
  readonly name: string;
  /** Index into the diagram's actor order — the renderer owns the palette. */
  readonly colorIndex: number;
  readonly center: Point;
  readonly r: number;
}

export interface JourneyTaskBox {
  readonly id: TaskId;
  readonly name: string;
  readonly score: number;
  /** The title box; the column's hit target. */
  readonly rect: Rect;
  readonly mood: JourneyMood;
  /** Face marker centre — its y encodes the score. */
  readonly facePos: Point;
  readonly faceR: number;
  /** Dashed drop line from the title box down to the face. */
  readonly track: { readonly x: number; readonly y1: number; readonly y2: number };
  readonly actors: readonly JourneyActorMark[];
}

export interface JourneySectionBand {
  readonly id: SectionId;
  readonly name: string;
  readonly rect: Rect;
  /** Index into the section order — the renderer owns the palette. */
  readonly colorIndex: number;
}

export interface JourneyLegendItem {
  readonly name: string;
  readonly colorIndex: number;
  readonly swatch: Rect;
  readonly textPos: Point;
}

export interface JourneyLayout {
  readonly kind: "journey";
  readonly size: { readonly w: number; readonly h: number };
  readonly title?: string;
  readonly titlePos?: Point;
  readonly sections: readonly JourneySectionBand[];
  readonly tasks: readonly JourneyTaskBox[];
  readonly legend: readonly JourneyLegendItem[];
}

export function layoutJourney(ir: JourneyIR, measure: TextMeasurer): JourneyLayout {
  const actorOrder = journeyActors(ir);
  const colorOf = (actor: string) => Math.max(0, actorOrder.indexOf(actor));

  const hasTitle = ir.title !== undefined && ir.title !== "";
  const sectionY = hasTitle ? TITLE_H : 0;
  const taskY = sectionY + SECTION_H + SECTION_GAP;

  // one text height for every task box: columns must line up
  const taskTextH = measure.measure("Ag", TASK_STYLE).h;
  const taskH = taskTextH + TASK_PAD_Y * 2;
  const actorsY = taskY + taskH + ACTOR_ROW_H / 2;
  const scoreTop = actorsY + ACTOR_ROW_H / 2 + SCORE_TOP_GAP + FACE_R;

  const widthOf = (name: string, actorCount: number): number => {
    const text = measure.measure(name, TASK_STYLE).w + TASK_PAD_X * 2;
    const actors = actorCount > 0 ? actorCount * (ACTOR_R * 2) + (actorCount - 1) * ACTOR_GAP + TASK_PAD_X * 2 : 0;
    return Math.max(TASK_MIN_W, text, actors);
  };

  const sections: JourneySectionBand[] = [];
  const tasks: JourneyTaskBox[] = [];
  let x = 0;

  ir.sections.forEach((section, sectionIndex) => {
    const bandStart = x;
    for (const task of section.tasks) {
      const w = widthOf(task.name, task.actors.length);
      const cx = x + w / 2;
      // score 5 sits on the top row, 1 on the bottom
      const faceY = scoreTop + (5 - task.score) * SCORE_STEP;
      const span = task.actors.length * (ACTOR_R * 2) + Math.max(0, task.actors.length - 1) * ACTOR_GAP;
      const actorStart = cx - span / 2 + ACTOR_R;
      tasks.push({
        id: task.id,
        name: task.name,
        score: task.score,
        rect: { x, y: taskY, w, h: taskH },
        mood: moodForScore(task.score),
        facePos: { x: cx, y: faceY },
        faceR: FACE_R,
        track: { x: cx, y1: taskY + taskH, y2: faceY - FACE_R },
        actors: task.actors.map((name, i) => ({
          name,
          colorIndex: colorOf(name),
          center: { x: actorStart + i * (ACTOR_R * 2 + ACTOR_GAP), y: actorsY },
          r: ACTOR_R,
        })),
      });
      x += w + TASK_GAP;
    }
    const bandW = section.tasks.length > 0 ? x - TASK_GAP - bandStart : EMPTY_SECTION_W;
    if (section.tasks.length === 0) x += EMPTY_SECTION_W + TASK_GAP;
    sections.push({
      id: section.id,
      name: section.name,
      rect: { x: bandStart, y: sectionY, w: bandW, h: SECTION_H },
      colorIndex: sectionIndex,
    });
  });

  const contentW = Math.max(x - TASK_GAP, 0);

  // legend: one row of swatch + name, in first-appearance order
  const legendY = scoreTop + 4 * SCORE_STEP + FACE_R + LEGEND_GAP;
  const legend: JourneyLegendItem[] = [];
  let lx = 0;
  for (const [i, name] of actorOrder.entries()) {
    const textW = measure.measure(name, LEGEND_STYLE).w;
    legend.push({
      name,
      colorIndex: i,
      swatch: { x: lx, y: legendY, w: LEGEND_SWATCH, h: LEGEND_SWATCH },
      textPos: { x: lx + LEGEND_SWATCH + 5, y: legendY + LEGEND_SWATCH / 2 },
    });
    lx += LEGEND_SWATCH + 5 + textW + LEGEND_ITEM_GAP;
  }

  const titleW = hasTitle ? measure.measure(ir.title!, TITLE_STYLE).w : 0;
  const legendW = legend.length > 0 ? lx - LEGEND_ITEM_GAP : 0;
  const w = Math.max(contentW, titleW, legendW, TASK_MIN_W);
  const h = (legend.length > 0 ? legendY + LEGEND_SWATCH : scoreTop + 4 * SCORE_STEP + FACE_R) + 4;

  return {
    kind: "journey",
    size: { w, h },
    ...(hasTitle ? { title: ir.title!, titlePos: { x: w / 2, y: TITLE_H / 2 } } : {}),
    sections,
    tasks,
    legend,
  };
}

