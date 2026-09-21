import { describe, expect, it } from "vitest";
import type { JourneyIR, SectionId, TaskId } from "@gmermaid/ir";
import { fixedWidthMeasurer } from "./measurer";
import { layoutJourney, moodForScore } from "./journey";

const S = (s: string) => s as SectionId;
const T = (s: string) => s as TaskId;

const ir: JourneyIR = {
  kind: "journey",
  title: "My working day",
  sections: [
    {
      id: S("s1"),
      name: "Go to work",
      tasks: [
        { id: T("t1"), name: "Make tea", score: 5, actors: ["Me"] },
        { id: T("t2"), name: "Do work", score: 1, actors: ["Me", "Cat"] },
      ],
    },
    { id: S("s2"), name: "Go home", tasks: [{ id: T("t3"), name: "Sit down", score: 3, actors: ["Me"] }] },
  ],
};

describe("layoutJourney", () => {
  it("matches the committed golden layout", () => {
    expect(layoutJourney(ir, fixedWidthMeasurer())).toMatchSnapshot();
  });

  it("lays tasks out left to right and bands each section across its own tasks", () => {
    const result = layoutJourney(ir, fixedWidthMeasurer());
    const [t1, t2, t3] = result.tasks;
    expect(result.tasks.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
    expect(t1!.rect.x).toBeLessThan(t2!.rect.x);
    expect(t2!.rect.x).toBeLessThan(t3!.rect.x);
    // every task box sits on the same row
    expect(new Set(result.tasks.map((t) => t.rect.y)).size).toBe(1);
    const [work, home] = result.sections;
    expect(work!.rect.x).toBe(t1!.rect.x);
    expect(work!.rect.x + work!.rect.w).toBe(t2!.rect.x + t2!.rect.w);
    expect(home!.rect.x).toBe(t3!.rect.x);
    // bands sit above the task row
    expect(work!.rect.y + work!.rect.h).toBeLessThanOrEqual(t1!.rect.y);
  });

  it("puts the face marker at a height that encodes the score", () => {
    const result = layoutJourney(ir, fixedWidthMeasurer());
    const [best, worst, middling] = result.tasks;
    expect(best!.facePos.y).toBeLessThan(middling!.facePos.y);
    expect(middling!.facePos.y).toBeLessThan(worst!.facePos.y);
    expect([best!.mood, middling!.mood, worst!.mood]).toEqual(["happy", "neutral", "sad"]);
    expect([1, 2, 3, 4, 5].map(moodForScore)).toEqual(["sad", "sad", "neutral", "happy", "happy"]);
    // the drop line runs from the task box down to the face
    expect(best!.track.y1).toBe(best!.rect.y + best!.rect.h);
    expect(best!.track.y2).toBeLessThan(best!.facePos.y);
  });

  it("colours actor circles and the legend by first-appearance index", () => {
    const result = layoutJourney(ir, fixedWidthMeasurer());
    expect(result.legend.map((l) => [l.name, l.colorIndex])).toEqual([
      ["Me", 0],
      ["Cat", 1],
    ]);
    const doWork = result.tasks[1]!;
    expect(doWork.actors.map((a) => [a.name, a.colorIndex])).toEqual([
      ["Me", 0],
      ["Cat", 1],
    ]);
    // actor circles are centred under their own column
    const cx = doWork.rect.x + doWork.rect.w / 2;
    const mid = (doWork.actors[0]!.center.x + doWork.actors[1]!.center.x) / 2;
    expect(mid).toBeCloseTo(cx, 5);
    // the legend is below every face marker
    expect(result.legend[0]!.swatch.y).toBeGreaterThan(Math.max(...result.tasks.map((t) => t.facePos.y)));
  });

  it("gives an empty section a clickable band and an empty diagram finite sizes, pure JSON throughout", () => {
    const withEmpty = layoutJourney(
      { kind: "journey", sections: [{ id: S("s1"), name: "Empty", tasks: [] }] },
      fixedWidthMeasurer(),
    );
    expect(withEmpty.sections[0]!.rect.w).toBeGreaterThan(0);
    expect(withEmpty.title).toBeUndefined();
    const empty = layoutJourney({ kind: "journey", sections: [] }, fixedWidthMeasurer());
    expect(Number.isFinite(empty.size.w)).toBe(true);
    expect(Number.isFinite(empty.size.h)).toBe(true);
    const result = layoutJourney(ir, fixedWidthMeasurer());
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
