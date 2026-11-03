import { describe, expect, it } from "vitest";
import { quadrantToMermaid } from "@gmermaid/mermaid-codegen";
import { parseQuadrant } from "./quadrant";

/** parse → codegen → parse must land on the same IR, and the text form must
 * then be a fixpoint. */
function expectRoundTrip(code: string) {
  const first = parseQuadrant(code);
  expect(first.ok).toBe(true);
  if (!first.ok) throw new Error("unparseable");
  const regen = quadrantToMermaid(first.ir);
  const back = parseQuadrant(regen);
  expect(back.ok).toBe(true);
  if (!back.ok) throw new Error("regenerated code does not parse");
  expect(back.ir).toEqual(first.ir);
  expect(quadrantToMermaid(back.ir)).toBe(regen);
  return first;
}

const DOCS = `quadrantChart
    title Reach and engagement of campaigns
    x-axis Low Reach --> High Reach
    y-axis Low Engagement --> High Engagement
    quadrant-1 We should expand
    quadrant-2 Need to promote
    quadrant-3 Re-evaluate
    quadrant-4 May be improved
    Campaign A: [0.3, 0.6]
    Campaign B: [0.45, 0.23]
    Campaign C: [0.57, 0.69]
`;

describe("parseQuadrant", () => {
  it("reads the docs sample", () => {
    const { ir, warnings } = expectRoundTrip(DOCS);
    expect(warnings).toEqual([]);
    expect(ir.title).toBe("Reach and engagement of campaigns");
    expect(ir.xAxis).toEqual({ low: "Low Reach", high: "High Reach" });
    expect(ir.yAxis).toEqual({ low: "Low Engagement", high: "High Engagement" });
    expect(ir.quadrants).toEqual(["We should expand", "Need to promote", "Re-evaluate", "May be improved"]);
    expect(ir.points.map((p) => [p.id, p.label, p.x, p.y])).toEqual([
      ["point-1", "Campaign A", 0.3, 0.6],
      ["point-2", "Campaign B", 0.45, 0.23],
      ["point-3", "Campaign C", 0.57, 0.69],
    ]);
  });

  it("accepts a single-ended axis, quoted text and no coordinates spacing", () => {
    const { ir } = expectRoundTrip(`quadrantChart
  x-axis Low
  y-axis "Up --> down" --> "High: really"
  "Odd: name [1]":[0,1]
  Plain:  [ 1 ,0.5 ]
`);
    expect(ir.xAxis).toEqual({ low: "Low", high: "" });
    expect(ir.yAxis).toEqual({ low: "Up --> down", high: "High: really" });
    expect(ir.points.map((p) => [p.label, p.x, p.y])).toEqual([
      ["Odd: name [1]", 0, 1],
      ["Plain", 1, 0.5],
    ]);
  });

  it("a high-only axis survives the round trip through its blank low end", () => {
    const { ir } = expectRoundTrip('quadrantChart\n  x-axis " " --> "High"\n');
    expect(ir.xAxis).toEqual({ low: "", high: "High" });
    expect(quadrantToMermaid(ir)).toContain('x-axis " " --> "High"');
  });

  it("tolerates and drops point styling, :::class and classDef, saying so", () => {
    const result = parseQuadrant(`quadrantChart
  A:::c1: [0.3, 0.6] radius: 20, color: #ff0000
  B: [0.45, 0.23] stroke-color: #10f0f0, stroke-width: 5px
  classDef c1 color: #109060, radius: 10
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.points.map((p) => [p.label, p.x, p.y])).toEqual([
      ["A", 0.3, 0.6],
      ["B", 0.45, 0.23],
    ]);
    expect(result.warnings).toEqual([
      { line: 2, message: "`:::` is not represented in the editor and will be lost on save" },
      // the shared line pass reports first, then the point parser
      { line: 4, message: "`classDef` is not represented in the editor and will be lost on save" },
      { line: 2, message: "`radius, color` is not represented in the editor and will be lost on save" },
      { line: 3, message: "`stroke-color, stroke-width` is not represented in the editor and will be lost on save" },
    ]);
    // the regenerated text no longer carries any of it
    expect(quadrantToMermaid(result.ir)).not.toMatch(/radius|color|classDef|:::/);
  });

  it("keeps free text that merely starts with a keyword, and skips comments and frontmatter", () => {
    const { ir, warnings } = expectRoundTrip(`---
title: ignored
---
%%{init: {}}%%
quadrantChart
  %% a comment
  style guide: [0.2, 0.7]
  title: [0.1, 0.1]
`);
    expect(warnings).toEqual([]);
    expect(ir.points.map((p) => p.label)).toEqual(["style guide", "title"]);
  });

  it("reads an empty title as no title, and the last of two titles wins like mermaid", () => {
    expect(expectRoundTrip("quadrantChart\n  title\n").ir.title).toBeUndefined();
    expect(expectRoundTrip("quadrantChart\n  title A\n  title B\n").ir.title).toBe("B");
  });

  it("sanitizes a bare quote so the quoted form can carry the text", () => {
    const { ir } = expectRoundTrip('quadrantChart\n  title say "hi" now\n');
    expect(ir.title).toBe("say 'hi' now");
  });

  it("keeps duplicate point names as separate points", () => {
    const { ir } = expectRoundTrip("quadrantChart\n  A: [0.1, 0.1]\n  A: [0.2, 0.2]\n");
    expect(ir.points.map((p) => p.id)).toEqual(["point-1", "point-2"]);
  });

  it.each([
    ["a wrong header", "quadrant\n  A: [0.1, 0.1]\n", /header/],
    ["a coordinate above 1", "quadrantChart\n  A: [1.5, 0.1]\n", /between 0 and 1/],
    ["a negative coordinate", "quadrantChart\n  A: [-0.5, 0.1]\n", /between 0 and 1/],
    ["a non-numeric coordinate", "quadrantChart\n  A: [left, 0.1]\n", /numbers/],
    ["junk after the coordinates", "quadrantChart\n  A: [0.1, 0.1] sparkly\n", /unexpected text/],
    ["quadrant-5", "quadrantChart\n  quadrant-5 Nope\n", /only 1 to 4/],
    ["a quadrant with no label", "quadrantChart\n  quadrant-1\n", /needs a label/],
    ["an axis with no label", "quadrantChart\n  x-axis\n", /needs a label/],
    ["an unknown statement", "quadrantChart\n  hello world\n", /unrecognized/],
    ["a nameless point", 'quadrantChart\n  "": [0.1, 0.1]\n', /needs a name/],
  ])("refuses %s with a reason", (_name, code, message) => {
    const result = parseQuadrant(code);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.message).join("\n")).toMatch(message);
  });

  it("reports errors at their original line", () => {
    const result = parseQuadrant("quadrantChart\n  title T\n  A: [9, 0]\n");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.line).toBe(3);
  });
});
