import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { JourneyIR, SectionId, TaskId } from "@gmermaid/ir";
import { fixedWidthMeasurer, layoutJourney } from "@gmermaid/layout";
import { JourneyView } from "./JourneyView";

const ir: JourneyIR = {
  kind: "journey",
  title: "My working day",
  sections: [
    {
      id: "s1" as SectionId,
      name: "Go to work",
      tasks: [
        { id: "t1" as TaskId, name: "Make tea", score: 5, actors: ["Me"] },
        { id: "t2" as TaskId, name: "Do work", score: 1, actors: ["Me", "Cat"] },
      ],
    },
    { id: "s2" as SectionId, name: "Go home", tasks: [{ id: "t3" as TaskId, name: "Sit down", score: 3, actors: ["Me"] }] },
  ],
};

const layout = layoutJourney(ir, fixedWidthMeasurer());

describe("JourneyView", () => {
  it("matches the committed SVG snapshot", () => {
    expect(renderToStaticMarkup(<JourneyView layout={layout} viewState={{ selectedId: "t2" }} />)).toMatchSnapshot();
  });

  it("emits every task and section id as a data-element-id (id contract, ADR 0001)", () => {
    const html = renderToStaticMarkup(<JourneyView layout={layout} viewState={{}} />);
    const domIds = [...html.matchAll(/data-element-id="([^"]+)"/g)].map((m) => m[1]);
    const layoutIds = [...layout.sections.map((s) => s.id), ...layout.tasks.map((t) => t.id)];
    expect(domIds.toSorted()).toEqual(layoutIds.toSorted());
  });
});
