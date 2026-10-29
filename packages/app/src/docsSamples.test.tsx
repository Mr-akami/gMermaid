// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fixedWidthMeasurer, layoutGantt, layoutJourney, layoutMindmap, layoutRequirementDiagram, layoutTimeline } from "@gmermaid/layout";
import { parseGantt, parseJourney, parseMindmap, parseRequirementDiagram, parseTimeline, type ParseResult } from "@gmermaid/mermaid-parser";
import { GanttView, JourneyView, MindmapView, RequirementView, TimelineView } from "@gmermaid/renderer";

// The samples from mermaid's own docs, pasted in whole, reach the canvas:
// parse → layout → the view's SVG. What the e2e suite used to check with a
// browser per kind, minus the browser — nothing here needs real pixels, only
// the drawn elements and their text.

const measure = fixedWidthMeasurer();

function ok<T>(r: ParseResult<T>): T {
  if (!r.ok) throw new Error(r.errors.map((e) => `line ${e.line}: ${e.message}`).join("\n"));
  return r.ir;
}

/** The view's markup as a DOM, to query like the canvas. */
function draw(element: React.ReactElement): Element {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(element);
  return host;
}

const ids = (root: Element, selector = "[data-element-id]") => root.querySelectorAll(selector).length;
const texts = (root: Element) => [...root.querySelectorAll("text")].map((t) => t.textContent ?? "");
const hasText = (root: Element, needle: string | RegExp) =>
  texts(root).some((t) => (typeof needle === "string" ? t.includes(needle) : needle.test(t)));

describe("mermaid docs samples render", () => {
  it("gantt: a bar per task, a band per section, a dated axis", () => {
    const root = draw(<GanttView layout={layoutGantt(ok(parseGantt(GANTT)), measure)} viewState={{}} />);
    // 4 tasks + 2 sections, each carrying a data-element-id
    expect(ids(root)).toBe(6);
    expect(root.querySelectorAll('[data-element-id^="task-"] rect').length).toBe(4);
    expect(hasText(root, "A Gantt Diagram")).toBe(true);
    expect(hasText(root, "Task in Another")).toBe(true);
    // the axis is labelled with dates from the resolved domain
    expect(hasText(root, /^2014-0\d-\d\d$/)).toBe(true);
  });

  it("journey: every task and section, and a legend entry per actor", () => {
    const root = draw(<JourneyView layout={layoutJourney(ok(parseJourney(JOURNEY)), measure)} viewState={{}} />);
    // 5 tasks + 2 sections
    expect(ids(root)).toBe(7);
    expect(hasText(root, "My working day")).toBe(true);
    expect(hasText(root, "Make tea")).toBe(true);
    expect(hasText(root, "Cat")).toBe(true);
  });

  it("timeline: every section, period and event, with <br> as a line break", () => {
    const root = draw(<TimelineView layout={layoutTimeline(ok(parseTimeline(TIMELINE)), measure)} viewState={{}} />);
    // 2 sections + 5 periods + 5 events
    expect(ids(root)).toBe(12);
    expect(hasText(root, "Timeline of Industrial Revolution")).toBe(true);
    expect(hasText(root, "21st century")).toBe(true);
    expect(hasText(root, "Industry 4.0")).toBe(true);
    // `Steam <br>power`: the `<br>` became a real line break, so "power"
    // stands on a line of its own and no raw tag reaches the canvas
    const lines = [...root.querySelectorAll("tspan")].map((t) => t.textContent?.trim());
    expect(lines).toContain("power");
    expect(texts(root).some((t) => t.includes("<br"))).toBe(false);
  });

  it("mindmap: every node, <br/> split over lines, the icon kept with its node", () => {
    const root = draw(<MindmapView layout={layoutMindmap(ok(parseMindmap(MINDMAP)), measure)} viewState={{}} />);
    // 15 nodes; the `::icon(…)` line decorates one of them instead of adding one
    expect(ids(root)).toBe(15);
    expect(hasText(root, "Popularisation")).toBe(true);
    expect(hasText(root, "Argument mapping")).toBe(true);
    // `On effectiveness<br/>and features`: split over two lines
    expect([...root.querySelectorAll("tspan")].map((t) => t.textContent?.trim())).toContain("and features");
    expect(hasText(root, "fa fa-book")).toBe(true);
  });

  it("requirement: every box and relation, with type header, fields and relation labels", () => {
    const root = draw(<RequirementView layout={layoutRequirementDiagram(ok(parseRequirementDiagram(REQUIREMENT)), measure)} viewState={{}} />);
    // 9 boxes (6 requirements + 3 elements) and 8 relation edges
    expect(ids(root, "g[data-drag='connect']")).toBe(9);
    expect(ids(root)).toBe(17);
    const box = (id: string) => root.querySelector(`[data-element-id="${id}"]`)?.textContent ?? "";
    expect(box("test_req4")).toContain("«interfaceRequirement»");
    expect(box("test_req4")).toContain("Risk: Medium");
    expect(box("test_entity3")).toContain("Doc Ref: github.com/all_the_tests");
    expect(box("relation-1")).toContain("«satisfies»");
    // the mirrored `test_req <- copies - test_entity2` becomes an ordinary edge
    expect(box("relation-8")).toContain("«copies»");
  });
});

const GANTT = `gantt
    title A Gantt Diagram
    dateFormat YYYY-MM-DD
    section Section
        A task          :a1, 2014-01-01, 30d
        Another task    :after a1, 20d
    section Another
        Task in Another :2014-01-12, 12d
        another task    :24d
`;

const JOURNEY = `journey
    title My working day
    section Go to work
      Make tea: 5: Me
      Go upstairs: 3: Me
      Do work: 1: Me, Cat
    section Go home
      Go downstairs: 5: Me
      Sit down: 5: Me
`;

const TIMELINE = `timeline
    title Timeline of Industrial Revolution
    section 17th-20th century
        Industry 1.0 : Machinery, Water power, Steam <br>power
        Industry 2.0 : Electricity, Internal combustion engine, Mass production
        Industry 3.0 : Electronics, Computers, Automation
    section 21st century
        Industry 4.0 : Internet, Robotics, Internet of Things
        Industry 5.0 : Artificial intelligence, Big data, 3D printing
`;

const MINDMAP = `mindmap
  root((mindmap))
    Origins
      Long history
      ::icon(fa fa-book)
      Popularisation
        British popular psychology author Tony Buzan
    Research
      On effectiveness<br/>and features
      On Automatic creation
        Uses
            Creative techniques
            Strategic planning
            Argument mapping
    Tools
      Pen and paper
      Mermaid
`;

const REQUIREMENT = `requirementDiagram

requirement test_req {
id: 1
text: the test text.
risk: high
verifymethod: test
}

functionalRequirement test_req2 {
id: 1.1
text: the second test text.
risk: low
verifymethod: inspection
}

performanceRequirement test_req3 {
id: 1.2
text: the third test text.
risk: medium
verifymethod: demonstration
}

interfaceRequirement test_req4 {
id: 1.2.1
text: the fourth test text.
risk: medium
verifymethod: analysis
}

physicalRequirement test_req5 {
id: 1.2.2
text: the fifth test text.
risk: medium
verifymethod: analysis
}

designConstraint test_req6 {
id: 1.2.3
text: the sixth test text.
risk: medium
verifymethod: analysis
}

element test_entity {
type: simulation
}

element test_entity2 {
type: word doc
docRef: reqs/test_entity
}

element test_entity3 {
type: "test suite"
docRef: github.com/all_the_tests
}

test_entity - satisfies -> test_req2
test_req - traces -> test_req2
test_req - contains -> test_req3
test_req3 - contains -> test_req4
test_req4 - derives -> test_req5
test_req5 - refines -> test_req6
test_entity3 - verifies -> test_req5
test_req <- copies - test_entity2
`;
