import { describe, expect, it } from "vitest";
import { journeyToMermaid } from "@gmermaid/mermaid-codegen";
import { parseJourney } from "./journey";

const DOCS_SAMPLE = `journey
    title My working day
    section Go to work
      Make tea: 5: Me
      Go upstairs: 3: Me
      Do work: 1: Me, Cat
    section Go home
      Go downstairs: 5: Me
      Sit down: 5: Me
`;

describe("parseJourney", () => {
  it("parses the docs sample: title, sections, scored tasks with actors", () => {
    const result = parseJourney(DOCS_SAMPLE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.title).toBe("My working day");
    expect(result.ir.sections.map((s) => s.name)).toEqual(["Go to work", "Go home"]);
    expect(result.ir.sections[0]!.tasks.map((t) => [t.name, t.score, t.actors])).toEqual([
      ["Make tea", 5, ["Me"]],
      ["Go upstairs", 3, ["Me"]],
      ["Do work", 1, ["Me", "Cat"]],
    ]);
    // round trip: gen(parse(x)) reparses to the same IR, and gen is stable
    const regen = journeyToMermaid(result.ir);
    const back = parseJourney(regen);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.ir).toEqual(result.ir);
    expect(journeyToMermaid(back.ir)).toBe(regen);
  });

  it("puts tasks before any section into an implicit unnamed section", () => {
    const result = parseJourney(`journey
  Wake up: 2
  section Morning
  Coffee: 5: Me
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.title).toBeUndefined();
    expect(result.ir.sections.map((s) => [s.name, s.tasks.length])).toEqual([
      ["", 1],
      ["Morning", 1],
    ]);
    expect(result.ir.sections[0]!.tasks[0]!.actors).toEqual([]);
    const regen = journeyToMermaid(result.ir);
    expect(regen).toBe("journey\n    Wake up: 2\n  section Morning\n    Coffee: 5: Me\n");
    const back = parseJourney(regen);
    expect(back.ok && back.ir).toEqual(result.ir);
  });

  it("follows mermaid's field rule: score then actors, extra `:` fields ignored, `#` comments cut", () => {
    const result = parseJourney(`journey
  %% comment
  Do it: 4: A, B: ignored tail
  Another: 3 # trailing comment
  Third: 2: X;
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tasks = result.ir.sections[0]!.tasks;
    expect(tasks.map((t) => [t.name, t.score, t.actors])).toEqual([
      ["Do it", 4, ["A", "B"]],
      ["Another", 3, []],
      ["Third", 2, ["X"]],
    ]);
  });

  it("tolerates frontmatter and directives, rejects a non-numeric score and junk", () => {
    const ok = parseJourney(`---\ntitle: fm\n---\n%%{init: {}}%%\njourney\n  section S\n  T: 1: Me\n`);
    expect(ok.ok).toBe(true);
    const bad = parseJourney("journey\n  T: high: Me\n  nonsense\n");
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.map((e) => e.line)).toEqual([2, 3]);
    const wrongHeader = parseJourney("flowchart TD\nA-->B");
    expect(wrongHeader.ok).toBe(false);
  });
});
