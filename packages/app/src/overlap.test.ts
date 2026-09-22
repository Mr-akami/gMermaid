import { describe, expect, it } from "vitest";
import {
  parseClassDiagram,
  parseFlowchart,
  parseGantt,
  parseJourney,
  parseMindmap,
  parseRequirementDiagram,
  parseSequence,
  parseStateDiagram,
  parseTimeline,
  parseUsecase,
  type ParseResult,
} from "@gmermaid/mermaid-parser";
import {
  fixedWidthMeasurer,
  layoutClassDiagram,
  layoutFlowchart,
  layoutGantt,
  layoutJourney,
  layoutMindmap,
  layoutRequirementDiagram,
  layoutSequence,
  layoutStateDiagram,
  layoutTimeline,
  layoutUsecase,
  segmentHitsRect,
  type Point,
  type Rect,
} from "@gmermaid/layout";

// Labels are the one thing a graph layout does not place for you. dagre only
// keeps a gap clear for an edge label when it is told the label's size, and it
// never sees the labels a layout synthesizes afterwards at all: self-loops,
// axis ticks, gutter titles. Each diagram below is built to crowd exactly
// those, and the test asserts that nothing drawn shares area with anything
// else — naming the pair when it does.

const measure = fixedWidthMeasurer(8);
const S = (fontSize: number) => ({ fontSize, fontFamily: "sans-serif" }) as const;

interface Box extends Rect {
  readonly what: string;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

type Anchor = "start" | "middle" | "end";

/** The box a renderer's <text> covers: x follows textAnchor, and y is a
 * baseline unless the element sets dominantBaseline="central". */
function textBox(
  text: string,
  at: Point,
  what: string,
  opt: { fontSize?: number; anchor?: Anchor; central?: boolean } = {},
): Box {
  const fontSize = opt.fontSize ?? 12;
  const m = measure.measure(text, S(fontSize));
  const anchor = opt.anchor ?? "middle";
  const x = anchor === "start" ? at.x : anchor === "end" ? at.x - m.w : at.x - m.w / 2;
  const y = opt.central ? at.y - m.h / 2 : at.y - m.h * 0.8;
  return { x, y, w: m.w, h: m.h, what };
}

const lbl = (text: string, at: Point, what: string, fontSize = 12): Box => textBox(text, at, what, { fontSize });

/** A frame's title, drawn inside its top-left corner. */
const frameTitle = (text: string, rect: Rect, what: string, fontSize: number): Box => ({
  x: rect.x,
  y: rect.y,
  w: measure.measure(text, S(fontSize)).w,
  h: measure.measure(text, S(fontSize)).h,
  what,
});

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

function parsed<T>(result: ParseResult<T>, what: string): T {
  if (!result.ok) throw new Error(`${what} did not parse: ${JSON.stringify(result.errors)}`);
  return result.ir;
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
    const layout = layoutFlowchart(parsed(parseFlowchart(src), "flowchart"), measure);
    const boxes: Box[] = [
      ...layout.nodes.map((n) => ({ ...n.rect, what: `node ${n.label}` })),
      ...layout.edges.flatMap((e) =>
        e.label !== undefined && e.labelPos !== undefined ? [lbl(e.label, e.labelPos, `label "${e.label}"`, 14)] : [],
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
    const layout = layoutStateDiagram(parsed(parseStateDiagram(src), "state"), measure);
    const boxes: Box[] = [
      ...layout.states.filter((s) => !s.composite).map((s) => ({ ...s.rect, what: `state ${s.id}` })),
      ...layout.transitions.flatMap((t) =>
        t.label !== undefined && t.labelPos !== undefined ? [lbl(t.label, t.labelPos, `label "${t.label}"`, 14)] : [],
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
    const layout = layoutClassDiagram(parsed(parseClassDiagram(src), "class"), measure);
    const boxes: Box[] = [
      ...layout.classes.map((c) => ({ ...c.rect, what: `class ${c.name}` })),
      ...layout.relations.flatMap((r) =>
        r.label !== undefined && r.labelPos !== undefined ? [lbl(r.label, r.labelPos, `label "${r.label}"`)] : [],
      ),
    ];
    expect(collisions(boxes)).toEqual([]);
  });
});

describe("labels dagre never saw find a free spot", () => {
  it("flowchart: subgraph titles, nested clusters and edges crossing a border", () => {
    const src = `flowchart LR
  subgraph s1["A subgraph with a long title"]
    a["Alpha"] -->|"edge inside"| b["Beta"]
  end
  subgraph s2["Second group"]
    c["Gamma"]
  end
  b -->|"crosses the cluster border"| c
  b -->|"back edge with a long label"| a
  c -->|"long label out"| d["Delta"]
  subgraph s3["Third group with a long name"]
    subgraph s4["Nested"]
      e["Epsilon"] -->|"nested edge label"| f["Zeta"]
    end
    g["Eta"]
  end
  d -->|"into the nest"| e
  f -->|"out of the nest again"| g
`;
    const l = layoutFlowchart(parsed(parseFlowchart(src), "flowchart"), measure);
    expect(
      collisions([
        ...l.nodes.map((n) => ({ ...n.rect, what: `node ${n.label}` })),
        ...l.subgraphs.map((s) => frameTitle(s.label, s.rect, `subgraph title ${s.label}`, 14)),
        ...l.edges.flatMap((e) =>
          e.label !== undefined && e.labelPos !== undefined ? [lbl(e.label, e.labelPos, `edge "${e.label}"`, 14)] : [],
        ),
      ]),
    ).toEqual([]);
  });

  it("state: self-transition labels, notes and a composite title", () => {
    const src = `stateDiagram-v2
  [*] --> Idle
  Idle --> Idle : retry the whole thing
  Idle --> Running : a fairly long trigger
  state Composite {
    [*] --> Inner
    Inner --> Inner : inner self loop
  }
  Running --> Composite : go in
  note right of Idle : a note about idling
  note left of Running : another note here
  Composite --> [*]
`;
    const l = layoutStateDiagram(parsed(parseStateDiagram(src), "state"), measure);
    expect(
      collisions([
        ...l.states.filter((s) => !s.composite).map((s) => ({ ...s.rect, what: `state ${s.label || s.id}` })),
        ...l.states
          .filter((s) => s.composite)
          .map((s) => frameTitle(s.label, s.rect, `composite title ${s.label}`, 14)),
        ...l.notes.map((n) => ({ ...n.rect, what: `note "${n.text}"` })),
        ...l.transitions.flatMap((t) =>
          t.label !== undefined && t.labelPos !== undefined ? [lbl(t.label, t.labelPos, `trans "${t.label}"`, 14)] : [],
        ),
      ]),
    ).toEqual([]);
  });

  it("class: cardinalities, a note, a namespace frame and a self-relation", () => {
    const src = `classDiagram
  class Alpha {
    +int id
    +run() void
  }
  class Beta
  class Gamma
  Alpha "1" --> "0..*" Beta : a long relation label
  Beta "1..*" --> "1" Gamma : another long one
  Alpha --> Alpha : recurses
  note for Beta "a note about Beta"
  namespace Pack {
    class Delta
    class Epsilon
  }
  Gamma --> Delta : crosses into the namespace
`;
    const l = layoutClassDiagram(parsed(parseClassDiagram(src), "class"), measure);
    expect(
      collisions([
        ...l.classes.map((c) => ({ ...c.rect, what: `class ${c.name}` })),
        ...l.namespaces.map((n) => frameTitle(n.name, n.rect, `namespace title ${n.name}`, 14)),
        ...l.notes.map((n) => ({ ...n.rect, what: `note "${n.text}"` })),
        ...l.relations.flatMap((r) => [
          ...(r.label !== undefined && r.labelPos !== undefined ? [lbl(r.label, r.labelPos, `rel "${r.label}"`)] : []),
          // cardinalities are drawn left-anchored from their end of the line
          ...(r.fromCardinality !== undefined && r.fromCardinalityPos !== undefined
            ? [textBox(r.fromCardinality, r.fromCardinalityPos, `card-from "${r.fromCardinality}" (${r.id})`, { fontSize: 11, anchor: "start" })]
            : []),
          ...(r.toCardinality !== undefined && r.toCardinalityPos !== undefined
            ? [textBox(r.toCardinality, r.toCardinalityPos, `card-to "${r.toCardinality}" (${r.id})`, { fontSize: 11, anchor: "start" })]
            : []),
        ]),
      ]),
    ).toEqual([]);
  });

  it("sequence: notes, activation bars, fragment tabs and a self-message", () => {
    const src = `sequenceDiagram
  participant A as Alice
  participant B as Bob
  participant C as Carol
  A->>B: a reasonably long message
  activate B
  Note right of A: a note beside Alice
  B->>B: talks to itself at length
  alt is it sunny?
    B->>C: forward the request onwards
    Note over C: note inside the fragment
  else it is raining
    C->>A: reply back the long way
  end
  deactivate B
  Note over A,C: a spanning note
  Note left of B: a note left of Bob
  loop every day
    A->>C: a long looping message here
    Note right of C: note right at the border
  end
`;
    const l = layoutSequence(parsed(parseSequence(src), "sequence"), measure);
    expect(
      collisions([
        ...l.lifelines.map((x) => ({ ...x.headRect, what: `head ${x.name}` })),
        ...l.activations.map((a, i) => ({ ...a.rect, what: `activation ${a.lifeline}#${i}` })),
        ...l.notes.map((n) => ({ ...n.rect, what: `note "${n.text}"` })),
        ...l.fragments.map((f) => ({ ...f.labelTab, what: `tab ${f.fragmentKind}` })),
        ...l.fragments.flatMap((f) =>
          f.branches.map((b) => textBox(b.condition, b.conditionPos, `cond "${b.condition}"`, { fontSize: 11, anchor: "start" })),
        ),
        // a self-message's label hangs off the right of its own detour
        ...l.messages.map((m) =>
          m.fromX === m.toX
            ? textBox(m.label, { x: m.fromX + 44, y: m.y + 9 }, `msg "${m.label}"`, { anchor: "start" })
            : lbl(m.label, m.labelPos, `msg "${m.label}"`),
        ),
      ]),
    ).toEqual([]);
  });

  it("requirement: relation labels and a self-relation", () => {
    const src = `requirementDiagram
  requirement first_req {
    id: 1
    text: the first requirement
    risk: high
    verifymethod: test
  }
  requirement second_req {
    id: 2
    text: the second requirement
    risk: low
    verifymethod: analysis
  }
  element some_element {
    type: simulation
  }
  first_req - satisfies -> second_req
  second_req - traces -> some_element
  some_element - derives -> first_req
  first_req - contains -> first_req
  first_req - refines -> some_element
`;
    const l = layoutRequirementDiagram(parsed(parseRequirementDiagram(src), "requirement"), measure);
    expect(
      collisions([
        ...l.boxes.map((b) => ({ ...b.rect, what: `box ${b.name}` })),
        ...l.edges.map((e) => lbl(e.label, e.labelPos, `edge "${e.label}"`)),
      ]),
    ).toEqual([]);
  });

  it("usecase: a boundary title, a note and a self-relation", () => {
    const src = `usecase-beta
direction LR
actor Customer("Customer")
actor Admin("Administrator")
systemBoundary "Order system"
  Checkout("Place an order")
  Track("Track the order")
  Refund("Refund an order")
end
Customer -- "initiates" --> Checkout
Customer -- "follows up on" --> Track
Admin -- "handles the case" --> Refund
Checkout -- "retries itself" --> Checkout
note for Checkout "validates the cart"
`;
    const l = layoutUsecase(parsed(parseUsecase(src), "usecase"), measure);
    expect(
      collisions([
        ...l.actors.map((a) => ({ ...a.rect, what: `actor ${a.label}` })),
        ...l.usecases.map((u) => ({ ...u.rect, what: `usecase ${u.label}` })),
        ...l.notes.map((n) => ({ ...n.rect, what: `note "${n.text}"` })),
        ...l.boundaries.map((b) => frameTitle(b.label, b.rect, `boundary title ${b.label}`, 13)),
        ...l.edges.flatMap((e) =>
          e.label !== undefined && e.labelPos !== undefined ? [lbl(e.label, e.labelPos, `edge "${e.label}"`, 11)] : [],
        ),
      ]),
    ).toEqual([]);
  });

  it("gantt: gutter names against section titles, and a crowded axis", () => {
    const src = `gantt
  title A schedule
  dateFormat YYYY-MM-DD
  axisFormat %Y-%m-%d
  section Design
    A very long task name here :a1, 2024-01-01, 30d
    Second task :a2, after a1, 20d
  section Build
    Third task :b1, 2024-02-20, 10d
    A milestone :milestone, m1, 2024-03-01, 0d
`;
    const l = layoutGantt(parsed(parseGantt(src), "gantt"), measure, Date.parse("2024-02-01"));
    expect(
      collisions([
        ...l.bars.map((b) => ({ ...b.rect, what: `bar ${b.label}` })),
        // the gutter name is right-aligned in its own column
        ...l.bars.map((b) =>
          textBox(b.label, { x: b.labelRect.x + b.labelRect.w - 10, y: b.labelRect.y + b.labelRect.h / 2 }, `task label ${b.label}`, {
            anchor: "end",
            central: true,
          }),
        ),
        ...l.sections.map((s) => textBox(s.name, { x: s.rect.x + 8, y: s.rect.y + 14 }, `section title ${s.name}`, { anchor: "start" })),
        ...l.ticks.flatMap((t) =>
          t.label === undefined ? [] : [textBox(t.label, { x: t.x, y: l.axisY - 8 }, `tick "${t.label}"`, { fontSize: 11 })],
        ),
      ]),
    ).toEqual([]);
    // thinning drops labels, never the gridlines they belong to
    expect(l.ticks.some((t) => t.label === undefined)).toBe(true);
  });

  it("journey: task titles, actor circles, section titles and the legend", () => {
    const src = `journey
  title My working day
  section Go to work
    Make tea: 5: Me
    Go upstairs and sit down: 3: Me, Cat
    Do work in the morning: 1: Me, Cat, Dog
  section Go home
    Go downstairs: 5: Me
    Sit down for dinner: 5: Me, Cat, Dog, Bird, Fish
  section A section with a rather long name
    A task with a very long name indeed: 2: Me, Cat, Dog, Bird, Fish, Hamster
`;
    const l = layoutJourney(parsed(parseJourney(src), "journey"), measure);
    expect(
      collisions([
        ...l.tasks.map((t) => ({ ...t.rect, what: `task ${t.name}` })),
        ...l.tasks.flatMap((t) =>
          t.actors.map((a) => ({ x: a.center.x - a.r, y: a.center.y - a.r, w: a.r * 2, h: a.r * 2, what: `actor ${a.name}@${t.name}` })),
        ),
        ...l.sections.map((s) => frameTitle(s.name, s.rect, `section title ${s.name}`, 13)),
        ...l.legend.map((g) => ({ ...g.swatch, what: `legend swatch ${g.name}` })),
        ...l.legend.map((g) => textBox(g.name, g.textPos, `legend text ${g.name}`, { anchor: "start", central: true })),
      ]),
    ).toEqual([]);
  });

  it("timeline: period boxes, event boxes and section bands", () => {
    const src = `timeline
  title History of Social Media
  section Ancient
    2002 : LinkedIn launches
    2004 : Facebook : Google
  section Modern
    2005 : YouTube
    2006 : Twitter and a much longer event text : A second event : A third event here
    2008 : Short
  section A section with a very long name indeed
    2010 : Instagram
`;
    const l = layoutTimeline(parsed(parseTimeline(src), "timeline"), measure);
    expect(
      collisions([
        ...l.periods.map((p) => ({ ...p.rect, what: `period ${p.label}` })),
        ...l.events.map((e) => ({ ...e.rect, what: `event ${e.text}` })),
        ...l.sections.map((s) => frameTitle(s.name, s.rect, `section title ${s.name}`, 14)),
      ]),
    ).toEqual([]);
  });

  it("mindmap: both sides of the root, and a deep subtree", () => {
    const src = `mindmap
  root((Root idea))
    Origins
      Long history of the thing
      Popularisation efforts
    Research
      On effectiveness
      On features
    Tools
      Pen and paper
      Mermaid
    Uses
      Creative techniques
      Strategic planning
      Argument mapping
    Extras
      A rather long leaf label here
      Another rather long leaf label
      Short
    More
      Deep
        Deeper
          Deepest leaf with a long name
`;
    const l = layoutMindmap(parsed(parseMindmap(src), "mindmap"), measure);
    expect(collisions(l.nodes.map((n) => ({ ...n.rect, what: `node ${n.label}` })))).toEqual([]);
  });
});

// Two boxes overlapping is only half the story. A polyline drawn across a
// node, a note or a label hides just as much text, and no pair of rectangles
// is involved — so nothing above catches it. These measure the other half:
// notes against everything else drawn, and every routed path (edge, self-loop
// detour, note leader) against every box it has no business touching.

/** The ink the renderer actually lays down for a polyline: `edgePath` feeds
 * the points through a uniform cubic B-spline, which rounds the corners and
 * so leaves the control polygon. Flatten the same curve, or the measurement
 * checks a line the reader never sees. */
function curve(points: readonly Point[], steps = 16): Point[] {
  const p: Point[] = [];
  for (const q of points) {
    const last = p[p.length - 1];
    if (last && Math.abs(last.x - q.x) < 0.01 && Math.abs(last.y - q.y) < 0.01) continue;
    p.push(q);
  }
  if (p.length < 3) return p;
  const out: Point[] = [p[0]!];
  const cubic = (a: Point, b: Point, c: Point, d: Point) => {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      out.push({
        x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
        y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
      });
    }
  };
  out.push({ x: (5 * p[0]!.x + p[1]!.x) / 6, y: (5 * p[0]!.y + p[1]!.y) / 6 });
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1]!;
    const b = p[i]!;
    const c = p[i + 1]!;
    cubic(
      out[out.length - 1]!,
      { x: (2 * a.x + b.x) / 3, y: (2 * a.y + b.y) / 3 },
      { x: (a.x + 2 * b.x) / 3, y: (a.y + 2 * b.y) / 3 },
      { x: (a.x + 4 * b.x + c.x) / 6, y: (a.y + 4 * b.y + c.y) / 6 },
    );
  }
  const last = p[p.length - 1]!;
  const prev = p[p.length - 2]!;
  cubic(
    out[out.length - 1]!,
    { x: (2 * prev.x + last.x) / 3, y: (2 * prev.y + last.y) / 3 },
    { x: (prev.x + 2 * last.x) / 3, y: (prev.y + 2 * last.y) / 3 },
    last,
  );
  return out;
}

interface Route {
  readonly points: readonly Point[];
  readonly what: string;
  /** Boxes this path is allowed to touch: the two it connects, its own label.
   * An edge has to reach its endpoints, and a label rides on its own line. */
  readonly ok: readonly string[];
}

/** A line ending exactly on a border is how an edge attaches to its node, so
 * the boxes are shrunk by a hair before asking: only ink that goes INTO a box
 * counts, never ink that stops at it. */
const GRAZE = 1.5;

/** Every path that runs through a box it should be keeping off, named. */
function crossings(routes: readonly Route[], boxes: readonly Box[]): string[] {
  const hits: string[] = [];
  for (const route of routes) {
    for (const box of boxes) {
      if (route.ok.includes(box.what)) continue;
      const r = { x: box.x + GRAZE, y: box.y + GRAZE, w: box.w - GRAZE * 2, h: box.h - GRAZE * 2 };
      if (r.w <= 0 || r.h <= 0) continue;
      const pts = route.points;
      for (let i = 1; i < pts.length; i++) {
        if (segmentHitsRect(pts[i - 1]!, pts[i]!, r)) {
          hits.push(`${route.what} ⨯ ${box.what}`);
          break;
        }
      }
    }
  }
  return hits;
}

/** How a state box is named in every measurement below. */
const named = (id: string): string => `state ${id}`;

/** A note's dashed leader, as a two-point path. */
const leaderRoute = (
  a: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number },
  what: string,
  ok: readonly string[],
): Route => ({
  points: [
    { x: a.x1, y: a.y1 },
    { x: a.x2, y: a.y2 },
  ],
  what,
  ok,
});

describe("notes and routed paths keep off everything else drawn", () => {
  // the diagram the bug was reported on: a fan wide enough that the spot
  // beside each note's target is already taken, by a box or by a route
  const crowdedState = `stateDiagram-v2
  direction LR
  [*] --> A
  A --> B
  A --> C
  A --> D
  B --> E
  C --> E
  D --> E
  note right of A : a note that is fairly wide
  note right of B : second note here
  note left of C : third note
`;

  it("state: notes in a crowded fan", () => {
    const ir = parsed(parseStateDiagram(crowdedState), "state");
    const l = layoutStateDiagram(ir, measure);
    const boxes: Box[] = [
      ...l.states.filter((s) => !s.composite).map((s) => ({ ...s.rect, what: named(s.id) })),
      ...l.notes.map((n) => ({ ...n.rect, what: `note "${n.text}"` })),
      ...l.transitions.flatMap((t) =>
        t.label !== undefined && t.labelPos !== undefined ? [lbl(t.label, t.labelPos, `trans "${t.label}"`, 14)] : [],
      ),
    ];
    expect(collisions(boxes)).toEqual([]);

    const ends = new Map(ir.transitions.map((t) => [t.id, [named(t.from), named(t.to)] as const]));
    expect(
      crossings(
        [
          ...l.transitions.map((t) => ({
            points: curve(t.points),
            what: `edge ${t.id}`,
            ok: [...(ends.get(t.id) ?? []), `trans "${t.label}"`],
          })),
          ...l.notes.map((n) => leaderRoute(n.anchor, `leader "${n.text}"`, [`note "${n.text}"`])),
        ],
        boxes,
      ),
    ).toEqual([]);
  });

  it("state: a transition between a composite and a state inside it", () => {
    // no container holds both ends, so this connector is drawn by hand — it
    // used to drop straight down the inner box's centre line, across the
    // frame's own title on the way
    const src = `stateDiagram-v2
  [*] --> Composite
  state Composite {
    [*] --> Inner
    Inner --> Second : inner move
  }
  Composite --> Inner : reach right back inside
  Second --> Composite : and back out again
  note right of Inner : a note on the inner state
`;
    const ir = parsed(parseStateDiagram(src), "state");
    const l = layoutStateDiagram(ir, measure);
    const boxes: Box[] = [
      ...l.states.filter((s) => !s.composite).map((s) => ({ ...s.rect, what: named(s.id) })),
      ...l.states
        .filter((s) => s.composite)
        .map((s) => frameTitle(s.label, s.rect, `composite title ${s.label}`, 14)),
      ...l.notes.map((n) => ({ ...n.rect, what: `note "${n.text}"` })),
      ...l.transitions.flatMap((t) =>
        t.label !== undefined && t.labelPos !== undefined ? [lbl(t.label, t.labelPos, `trans "${t.label}"`, 14)] : [],
      ),
    ];
    expect(collisions(boxes)).toEqual([]);

    const ends = new Map(ir.transitions.map((t) => [t.id, [named(t.from), named(t.to)] as const]));
    expect(
      crossings(
        [
          ...l.transitions.map((t) => ({
            points: curve(t.points),
            what: `edge ${t.id}`,
            ok: [...(ends.get(t.id) ?? []), `trans "${t.label}"`],
          })),
          ...l.notes.map((n) => leaderRoute(n.anchor, `leader "${n.text}"`, [`note "${n.text}"`])),
        ],
        boxes,
      ),
    ).toEqual([]);
  });

  it("class: a note dagre placed under a relation it later routed", () => {
    const src = `classDiagram
  direction LR
  class Alpha
  class Beta
  class Gamma
  class Delta
  Alpha --> Beta
  Alpha --> Gamma
  Alpha --> Delta
  Beta --> Delta
  Gamma --> Delta
  note for Alpha "a note that is fairly wide here"
  note for Beta "second note here"
  note for Gamma "third note"
`;
    const ir = parsed(parseClassDiagram(src), "class");
    const l = layoutClassDiagram(ir, measure);
    const nameOf = new Map(l.classes.map((c) => [c.id, `class ${c.name}`]));
    const boxes: Box[] = [
      ...l.classes.map((c) => ({ ...c.rect, what: `class ${c.name}` })),
      ...l.notes.map((n) => ({ ...n.rect, what: `note "${n.text}"` })),
      ...l.namespaces.map((n) => frameTitle(n.name, n.rect, `namespace title ${n.name}`, 14)),
    ];
    expect(collisions(boxes)).toEqual([]);

    const ends = new Map(ir.relations.map((r) => [r.id, [nameOf.get(r.from)!, nameOf.get(r.to)!] as const]));
    expect(
      crossings(
        [
          ...l.relations.map((r) => ({ points: curve(r.points), what: `rel ${r.id}`, ok: [...(ends.get(r.id) ?? [])] })),
          ...l.notes.flatMap((n) =>
            n.link === undefined ? [] : [{ points: n.link, what: `link "${n.text}"`, ok: [`note "${n.text}"`] }],
          ),
        ],
        boxes,
      ),
    ).toEqual([]);
  });

  it("usecase: notes beside a chain that already fills the space", () => {
    const src = `usecase-beta
direction LR
actor Customer("Customer")
actor Admin("Administrator")
systemBoundary "Order system"
  Checkout("Place an order")
  Track("Track the order")
  Refund("Refund an order")
end
Customer -- "initiates" --> Checkout
Customer -- "follows up on" --> Track
Customer -- "asks about" --> Refund
Admin -- "handles the case" --> Refund
Checkout -- "retries itself" --> Checkout
note for Checkout "validates the cart carefully"
note for Track "sends notifications"
note for Refund "third note"
`;
    const ir = parsed(parseUsecase(src), "usecase");
    const l = layoutUsecase(ir, measure);
    const nameOf = new Map<string, string>([
      ...l.actors.map((a): [string, string] => [a.id, `actor ${a.label}`]),
      ...l.usecases.map((u): [string, string] => [u.id, `usecase ${u.label}`]),
    ]);
    const boxes: Box[] = [
      ...l.actors.map((a) => ({ ...a.rect, what: `actor ${a.label}` })),
      ...l.usecases.map((u) => ({ ...u.rect, what: `usecase ${u.label}` })),
      ...l.notes.map((n) => ({ ...n.rect, what: `note "${n.text}"` })),
      ...l.boundaries.map((b) => frameTitle(b.label, b.rect, `boundary title ${b.label}`, 13)),
    ];
    expect(collisions(boxes)).toEqual([]);

    const ends = new Map(ir.relations.map((r) => [r.id, [nameOf.get(r.from)!, nameOf.get(r.to)!] as const]));
    expect(
      crossings(
        [
          ...l.edges.map((e) => ({ points: curve(e.points), what: `edge ${e.id}`, ok: [...(ends.get(e.id) ?? [])] })),
          ...l.notes.map((n) => leaderRoute(n.anchor, `leader "${n.text}"`, [`note "${n.text}"`])),
        ],
        boxes,
      ),
    ).toEqual([]);
  });

  it("requirement: relation paths against the boxes they run between", () => {
    const src = `requirementDiagram
  requirement first_req {
    id: 1
    text: the first requirement
    risk: high
    verifymethod: test
  }
  requirement second_req {
    id: 2
    text: the second requirement
    risk: low
    verifymethod: analysis
  }
  requirement third_req {
    id: 3
    text: the third requirement
    risk: medium
    verifymethod: inspection
  }
  element some_element {
    type: simulation
  }
  first_req - satisfies -> second_req
  first_req - traces -> third_req
  second_req - derives -> some_element
  third_req - derives -> some_element
  first_req - refines -> some_element
`;
    const ir = parsed(parseRequirementDiagram(src), "requirement");
    const l = layoutRequirementDiagram(ir, measure);
    const boxes: Box[] = l.boxes.map((b) => ({ ...b.rect, what: `box ${b.name}` }));
    const nameOf = new Map(l.boxes.map((b) => [b.id, `box ${b.name}`]));
    const ends = new Map(ir.relations.map((r) => [r.id, [nameOf.get(r.from)!, nameOf.get(r.to)!] as const]));
    expect(
      crossings(
        l.edges.map((e) => ({ points: curve(e.points), what: `edge ${e.id}`, ok: [...(ends.get(e.id) ?? [])] })),
        boxes,
      ),
    ).toEqual([]);
  });

  it("sequence: notes against heads, bars, tabs and the message lines", () => {
    const src = `sequenceDiagram
  participant A as Alice
  participant B as Bob
  participant C as Carol
  A->>B: a reasonably long message
  Note right of A: a note beside Alice
  Note left of B: a note left of Bob
  activate B
  B->>C: forward it onwards
  Note over B,C: a spanning note here
  Note over C: note on Carol
  deactivate B
  C->>A: reply back the long way
`;
    const l = layoutSequence(parsed(parseSequence(src), "sequence"), measure);
    const boxes: Box[] = [
      ...l.lifelines.map((x) => ({ ...x.headRect, what: `head ${x.name}` })),
      ...l.notes.map((n) => ({ ...n.rect, what: `note "${n.text}"` })),
      ...l.fragments.map((f) => ({ ...f.labelTab, what: `tab ${f.fragmentKind}` })),
    ];
    expect(collisions(boxes)).toEqual([]);
    // a message is a straight run between two spines; nothing drawn may sit on it
    expect(
      crossings(
        l.messages.map((m) => ({
          points: [
            { x: m.fromX, y: m.y },
            { x: m.toX, y: m.y },
          ],
          what: `msg "${m.label}"`,
          ok: [],
        })),
        boxes,
      ),
    ).toEqual([]);
  });
});
