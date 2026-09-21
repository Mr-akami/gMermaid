import { describe, expect, it } from "vitest";
import { parseClassDiagram, parseFlowchart, parseStateDiagram } from "@gmermaid/mermaid-parser";
import {
  fixedWidthMeasurer,
  layoutClassDiagram,
  layoutFlowchart,
  layoutStateDiagram,
  type Point,
  type Rect,
} from "@gmermaid/layout";

// Labels are the one thing a graph layout does not place for you: dagre only
// keeps a gap clear for an edge label when it is told the label's size. These
// diagrams have labels long enough to land on their own nodes if it is not.

const measure = fixedWidthMeasurer(8);
const LABEL = { fontSize: 14, fontFamily: "sans-serif" } as const;

interface Box extends Rect {
  readonly what: string;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function labelBox(label: string, at: Point, what: string): Box {
  const m = measure.measure(label, LABEL);
  return { x: at.x - m.w / 2, y: at.y - m.h / 2, w: m.w, h: m.h, what };
}

/** Every pair of boxes that share area, named so a failure says what hit what. */
function collisions(boxes: readonly Box[]): string[] {
  const hits: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlaps(boxes[i]!, boxes[j]!)) hits.push(`${boxes[i]!.what} ∩ ${boxes[j]!.what}`);
    }
  }
  return hits;
}

describe("edge labels keep clear of the nodes they run between", () => {
  it("flowchart", () => {
    const src = `flowchart LR
  a["A"] -->|"a long label here"| b["B"]
  a -->|"another long one"| c["C"]
  b -->|"third label"| c
  c -->|"fourth label text"| d["D"]
  a -->|"fifth"| d
`;
    const parsed = parseFlowchart(src);
    if (!parsed.ok) throw new Error("sample did not parse");
    const layout = layoutFlowchart(parsed.ir, measure);
    const boxes: Box[] = [
      ...layout.nodes.map((n) => ({ ...n.rect, what: `node ${n.label}` })),
      ...layout.edges.flatMap((e) =>
        e.label !== undefined && e.labelPos !== undefined ? [labelBox(e.label, e.labelPos, `label "${e.label}"`)] : [],
      ),
    ];
    expect(collisions(boxes)).toEqual([]);
  });

  it("state diagram", () => {
    const src = `stateDiagram-v2
  Idle --> Running : a fairly long trigger
  Running --> Paused : another long trigger
  Paused --> Idle : third long trigger
`;
    const parsed = parseStateDiagram(src);
    if (!parsed.ok) throw new Error("sample did not parse");
    const layout = layoutStateDiagram(parsed.ir, measure);
    const boxes: Box[] = [
      ...layout.states.filter((s) => !s.composite).map((s) => ({ ...s.rect, what: `state ${s.id}` })),
      ...layout.transitions.flatMap((t) =>
        t.label !== undefined && t.labelPos !== undefined ? [labelBox(t.label, t.labelPos, `label "${t.label}"`)] : [],
      ),
    ];
    expect(collisions(boxes)).toEqual([]);
  });

  it("class diagram", () => {
    const src = `classDiagram
  class Alpha
  class Beta
  class Gamma
  Alpha --> Beta : a long relation label
  Beta --> Gamma : another long one
  Alpha --> Gamma : third relation label
`;
    const parsed = parseClassDiagram(src);
    if (!parsed.ok) throw new Error("sample did not parse");
    const layout = layoutClassDiagram(parsed.ir, measure);
    const boxes: Box[] = [
      ...layout.classes.map((c) => ({ ...c.rect, what: `class ${c.name}` })),
      ...layout.relations.flatMap((r) =>
        r.label !== undefined && r.labelPos !== undefined ? [labelBox(r.label, r.labelPos, `label "${r.label}"`)] : [],
      ),
    ];
    expect(collisions(boxes)).toEqual([]);
  });
});
