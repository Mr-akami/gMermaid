// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import type {
  ActivationId,
  BoxId,
  BranchId,
  ClassIR,
  ClassId,
  EdgeId,
  FlowchartEdge,
  FlowchartIR,
  FragmentId,
  GanttIR,
  JourneyIR,
  LifecycleId,
  LifelineId,
  MessageId,
  NodeId,
  NoteId,
  RelationId,
  SectionId,
  RequirementIR,
  SequenceIR,
  StateIR,
  TaskId,
  TimelineIR,
  TransitionId,
} from "@gmermaid/ir";
import { FLOWCHART_SHAPES } from "@gmermaid/ir";
import mermaid from "mermaid";
import { flowchartToMermaid } from "./flowchart";
import { classToMermaid } from "./classdiagram";
import { ganttToMermaid } from "./gantt";
import { journeyToMermaid } from "./journey";
import { requirementToMermaid } from "./requirement";
import { sequenceToMermaid } from "./sequence";
import { stateToMermaid } from "./statediagram";
import { timelineToMermaid } from "./timeline";

// C4: our codegen output must be accepted by the REAL mermaid.js parser —
// the in-repo parser round trips prove self-consistency, not dialect
// compatibility. Runs under jsdom because mermaid touches the DOM on init.

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false });
});

async function expectMermaidAccepts(code: string): Promise<void> {
  await expect(mermaid.parse(code), code).resolves.toBeTruthy();
}

const N = (s: string) => s as NodeId;
const L = (s: string) => s as LifelineId;
const S = (s: string) => s as import("@gmermaid/ir").StateId;
const Q = (s: string) => s as import("@gmermaid/ir").RequirementId;
const EL = (s: string) => s as import("@gmermaid/ir").ElementId;
const G = (s: string) => s as import("@gmermaid/ir").SubgraphId;
const TS = (s: string) => s as SectionId;
const TP = (s: string) => s as import("@gmermaid/ir").PeriodId;
const TE = (s: string) => s as import("@gmermaid/ir").EventId;

describe("mermaid.js accepts generated flowcharts", () => {
  const base: FlowchartIR = {
    kind: "flowchart",
  subgraphs: [],
    direction: "TB",
    nodes: [
      { id: N("a"), label: "Start", shape: "rounded" },
      { id: N("b"), label: "Really? \"quoted\" & <b>html</b> #hash", shape: "diamond" },
      { id: N("c"), label: "multi\nline", shape: "stadium" },
    ],
    edges: [
      { id: "e1" as EdgeId, from: N("a"), to: N("b"), line: "solid", headStart: "none", headEnd: "arrow", label: "plain" },
      // the |"…"| form must survive labels containing the delimiter itself
      { id: "e2" as EdgeId, from: N("b"), to: N("c"), line: "dotted", headStart: "none", headEnd: "arrow", label: "a|b | c" },
      { id: "e3" as EdgeId, from: N("c"), to: N("a"), line: "thick", headStart: "none", headEnd: "arrow", label: 'quote " and #' },
    ],
  };

  it("parses shapes, escaped labels and every arrow type", async () => {
    await expectMermaidAccepts(flowchartToMermaid(base));
  });

  it("parses every extended node shape and the invisible link", async () => {
    const shapes = [
      "subroutine",
      "cylinder",
      "hexagon",
      "asymmetric",
      "doubleCircle",
      "parallelogram",
      "parallelogramAlt",
      "trapezoid",
      "trapezoidAlt",
    ] as const;
    const ir: FlowchartIR = {
      kind: "flowchart",
  subgraphs: [],
      direction: "TB",
      nodes: shapes.map((shape, i) => ({ id: N(`n${i}`), label: `shape ${shape}`, shape })),
      edges: [
        { id: "e1" as EdgeId, from: N("n0"), to: N("n1"), line: "invisible", headStart: "none", headEnd: "none" },
        { id: "e2" as EdgeId, from: N("n1"), to: N("n2"), line: "solid", headStart: "none", headEnd: "none", label: "still visible" },
      ],
    };
    await expectMermaidAccepts(flowchartToMermaid(ir));
  });

  it("parses nested subgraphs, per-subgraph direction and edges to a subgraph", async () => {
    const ir: FlowchartIR = {
      kind: "flowchart",
      direction: "TB",
      nodes: [
        { id: N("a"), label: "A & <b> #1", shape: "rect", parent: G("s1") },
        { id: N("b"), label: "B", shape: "rounded", parent: G("s2") },
        { id: N("c"), label: "C", shape: "rect" },
      ],
      edges: [
        { id: "e1" as EdgeId, from: N("c"), to: G("s1"), line: "solid", headStart: "none", headEnd: "arrow", label: "into the group" },
        { id: "e2" as EdgeId, from: N("a"), to: N("b"), line: "dotted", headStart: "none", headEnd: "arrow" },
      ],
      subgraphs: [
        { id: G("s1"), label: "Group \"one\"", direction: "LR" },
        { id: G("s2"), label: "Inner", parent: G("s1") },
      ],
    };
    await expectMermaidAccepts(flowchartToMermaid(ir));
  });

  it("parses edge labels containing pipes inside the |\"…\"| form", async () => {
    // isolate the pipe case so a failure names the actual suspect
    const ir: FlowchartIR = {
      ...base,
      nodes: base.nodes.slice(0, 2),
      edges: [{ id: "e2" as EdgeId, from: N("a"), to: N("b"), line: "solid", headStart: "none", headEnd: "arrow", label: "min|max" }],
    };
    await expectMermaidAccepts(flowchartToMermaid(ir));
  });

  it("parses every `@{ shape: … }` name we emit", async () => {
    // one diagram per shape: a bad name must point at the shape that broke
    for (const info of FLOWCHART_SHAPES) {
      const ir: FlowchartIR = {
        kind: "flowchart",
        subgraphs: [],
        direction: "TB",
        nodes: [
          { id: N("a"), label: `shape ${info.shape}`, shape: info.shape },
          { id: N("b"), label: "other", shape: "rect" },
        ],
        edges: [{ id: "e1" as EdgeId, from: N("a"), to: N("b"), line: "solid", headStart: "none", headEnd: "arrow" }],
      };
      await expectMermaidAccepts(flowchartToMermaid(ir));
    }
  });

  it("parses every line style × head pair and the extra-length links", async () => {
    const lines = ["solid", "dotted", "thick", "invisible"] as const;
    const heads = ["none", "arrow", "circle", "cross"] as const;
    const edges: FlowchartEdge[] = [];
    let i = 0;
    for (const line of lines) {
      for (const headEnd of heads) {
        for (const headStart of heads) {
          for (const length of [1, 2, 3]) {
            i += 1;
            edges.push({
              id: `e${i}` as EdgeId,
              from: N("a"),
              to: N("b"),
              line,
              headStart,
              headEnd,
              ...(length > 1 ? { length } : {}),
            });
          }
        }
      }
    }
    const ir: FlowchartIR = {
      kind: "flowchart",
      subgraphs: [],
      direction: "TB",
      nodes: [
        { id: N("a"), label: "A", shape: "rect" },
        { id: N("b"), label: "B", shape: "rect" },
      ],
      edges,
    };
    await expectMermaidAccepts(flowchartToMermaid(ir));
  });
});

describe("mermaid.js accepts generated class diagrams", () => {
  it("parses classes, members, stereotypes and every relation type", async () => {
    const ir: ClassIR = {
      kind: "class",
      classes: [
        {
          id: "Animal" as ClassId,
          name: "Animal",
          stereotype: "abstract",
          attributes: [{ name: "name", type: "String", visibility: "protected" }],
          methods: [{ name: "speak", params: "loud: bool", type: "String", visibility: "public" }],
        },
        { id: "Dog" as ClassId, name: "Dog", attributes: [], methods: [] },
      ],
      relations: [
        { id: "r1" as RelationId, from: "Dog" as ClassId, to: "Animal" as ClassId, type: "inheritance" },
        { id: "r2" as RelationId, from: "Dog" as ClassId, to: "Dog" as ClassId, type: "association", label: "parent", fromCardinality: "1", toCardinality: "0..1" },
        { id: "r3" as RelationId, from: "Animal" as ClassId, to: "Dog" as ClassId, type: "dependency" },
        { id: "r4" as RelationId, from: "Animal" as ClassId, to: "Dog" as ClassId, type: "composition" },
        { id: "r5" as RelationId, from: "Animal" as ClassId, to: "Dog" as ClassId, type: "aggregation" },
        { id: "r6" as RelationId, from: "Animal" as ClassId, to: "Dog" as ClassId, type: "realization" },
        { id: "r7" as RelationId, from: "Animal" as ClassId, to: "Dog" as ClassId, type: "linkSolid" },
        { id: "r8" as RelationId, from: "Animal" as ClassId, to: "Dog" as ClassId, type: "linkDashed" },
      ],
    };
    await expectMermaidAccepts(classToMermaid(ir));
  });

  it("parses the direction directive", async () => {
    const ir: ClassIR = {
      kind: "class",
      direction: "LR",
      classes: [
        { id: "A" as ClassId, name: "A", attributes: [], methods: [] },
        { id: "B" as ClassId, name: "B", attributes: [], methods: [] },
      ],
      relations: [{ id: "r1" as RelationId, from: "A" as ClassId, to: "B" as ClassId, type: "association" }],
    };
    await expectMermaidAccepts(classToMermaid(ir));
  });
});

describe("mermaid.js accepts generated sequence diagrams", () => {
  it("parses lifelines, arrows, notes and nested fragments with loop bounds", async () => {
    const ir: SequenceIR = {
      kind: "sequence",
      boxes: [],
      lifelines: [
        { id: L("a"), name: "Alice & <co> #1", kind: "actor" },
        { id: L("b"), name: "Bob", kind: "participant" },
      ],
      events: [
        { kind: "message", id: "m1" as MessageId, from: L("a"), to: L("b"), label: "hi > there", arrow: "solid" },
        {
          kind: "fragment",
          id: "f1" as FragmentId,
          fragmentKind: "loop",
          branches: [
            {
              id: "b1" as BranchId,
              condition: "until accepted",
              loopBounds: { min: "0", max: "3" },
              events: [{ kind: "message", id: "m2" as MessageId, from: L("b"), to: L("b"), label: "retry", arrow: "async" }],
            },
          ],
        },
        { kind: "note", id: "n1" as NoteId, position: "over", lifelines: [L("a"), L("b")], text: "done" },
      ],
    };
    await expectMermaidAccepts(sequenceToMermaid(ir));
  });

  it("parses autonumber, the extended arrows and break/critical fragments", async () => {
    const arrows = ["cross", "dottedCross", "dottedAsync", "bidirectional", "dottedBidirectional"] as const;
    const ir: SequenceIR = {
      kind: "sequence",
      boxes: [],
      autonumber: { start: 10, step: 2 },
      lifelines: [
        { id: L("a"), name: "a", kind: "participant" },
        { id: L("b"), name: "b", kind: "participant" },
      ],
      events: [
        ...arrows.map((arrow, i) => ({ kind: "message", id: `m${i}` as MessageId, from: L("a"), to: L("b"), label: arrow, arrow }) as const),
        {
          kind: "fragment",
          id: "f1" as FragmentId,
          fragmentKind: "break",
          branches: [
            { id: "b1" as BranchId, condition: "timeout", events: [{ kind: "message", id: "mb" as MessageId, from: L("a"), to: L("b"), label: "abort", arrow: "solid" }] },
          ],
        },
        {
          kind: "fragment",
          id: "f2" as FragmentId,
          fragmentKind: "critical",
          branches: [
            { id: "b2" as BranchId, condition: "lock", events: [{ kind: "message", id: "mc" as MessageId, from: L("a"), to: L("b"), label: "write", arrow: "solid" }] },
            { id: "b3" as BranchId, condition: "deadlock", events: [{ kind: "message", id: "md" as MessageId, from: L("a"), to: L("b"), label: "rollback", arrow: "solid" }] },
          ],
        },
      ],
    };
    await expectMermaidAccepts(sequenceToMermaid(ir));
  });

  it("parses activation, boxes, rect, create/destroy, participant types and multi-line text", async () => {
    const ir: SequenceIR = {
      kind: "sequence",
      lifelines: [
        { id: L("user"), name: "User", kind: "actor" },
        { id: L("api"), name: "API", kind: "control" },
        { id: L("db"), name: "Store", kind: "database" },
        { id: L("q"), name: "q", kind: "queue" },
        { id: L("w"), name: "Worker", kind: "participant" },
      ],
      boxes: [{ id: "box-1" as BoxId, name: "Back end", color: "rgb(200,220,255)", lifelines: [L("api"), L("db")] }],
      events: [
        { kind: "message", id: "m1" as MessageId, from: L("user"), to: L("api"), label: "login\nwith SSO", arrow: "solid", activate: "start" },
        {
          kind: "fragment",
          id: "r1" as FragmentId,
          fragmentKind: "rect",
          branches: [
            {
              id: "rb" as BranchId,
              condition: "rgba(0, 0, 255, .1)",
              events: [
                { kind: "message", id: "m2" as MessageId, from: L("api"), to: L("db"), label: "read", arrow: "solid" },
                { kind: "activation", id: "act-1" as ActivationId, lifeline: L("q"), on: true },
                { kind: "message", id: "m3" as MessageId, from: L("api"), to: L("q"), label: "enqueue", arrow: "async" },
                { kind: "activation", id: "act-2" as ActivationId, lifeline: L("q"), on: false },
              ],
            },
          ],
        },
        { kind: "create", id: "lc-1" as LifecycleId, lifeline: L("w") },
        { kind: "message", id: "m4" as MessageId, from: L("q"), to: L("w"), label: "work", arrow: "solid" },
        { kind: "destroy", id: "lc-2" as LifecycleId, lifeline: L("w") },
        { kind: "message", id: "m5" as MessageId, from: L("w"), to: L("api"), label: "done", arrow: "dotted" },
        { kind: "note", id: "n1" as NoteId, position: "over", lifelines: [L("user"), L("api")], text: "two\nlines" },
        { kind: "message", id: "m6" as MessageId, from: L("api"), to: L("user"), label: "token", arrow: "dotted", activate: "end" },
      ],
    };
    const code = sequenceToMermaid(ir);
    expect(code).toContain("user->>+api: login<br/>with SSO");
    expect(code).toContain("box rgb(200,220,255) Back end");
    expect(code).toContain('participant db@{ "type": "database" } as Store');
    expect(code).toContain("create participant w as Worker");
    expect(code).toContain("destroy w");
    await expectMermaidAccepts(code);
  });
});

describe("mermaid.js accepts generated state diagrams", () => {
  it("parses [*] start/end, aliased states, labeled transitions and direction", async () => {
    const ir: StateIR = {
      kind: "state",
  notes: [],
      direction: "LR",
      states: [
        { id: S("state_start"), label: "", role: "start" },
        { id: S("Still"), label: "Idle & <quiet> #1", role: "normal" },
        { id: S("Moving"), label: "Moving", role: "normal" },
        { id: S("Lonely"), label: "Lonely", role: "normal" }, // declared, never referenced
        { id: S("state_end"), label: "", role: "end" },
      ],
      transitions: [
        { id: "t1" as TransitionId, from: S("state_start"), to: S("Still") },
        { id: "t2" as TransitionId, from: S("Still"), to: S("Moving"), label: "push > hard" },
        { id: "t3" as TransitionId, from: S("Moving"), to: S("state_end") },
      ],
    };
    await expectMermaidAccepts(stateToMermaid(ir));
  });

  it("parses composites with scoped [*], choice/fork/join and notes", async () => {
    const ir: StateIR = {
      kind: "state",
      states: [
        { id: S("state_start"), label: "", role: "start" },
        { id: S("NS"), label: "Not shooting", role: "normal" },
        { id: S("Idle"), label: "Idle", role: "normal", parent: S("NS") },
        { id: S("state_start_NS"), label: "", role: "start", parent: S("NS") },
        { id: S("c1"), label: "", role: "choice" },
        { id: S("f1"), label: "", role: "fork" },
        { id: S("j1"), label: "", role: "join" },
      ],
      transitions: [
        { id: "t1" as TransitionId, from: S("state_start"), to: S("NS") },
        { id: "t2" as TransitionId, from: S("state_start_NS"), to: S("Idle") },
        { id: "t3" as TransitionId, from: S("NS"), to: S("c1") },
        { id: "t4" as TransitionId, from: S("c1"), to: S("f1"), label: "yes > no" },
        { id: "t5" as TransitionId, from: S("f1"), to: S("j1") },
      ],
      notes: [
        { id: "n1" as NoteId, target: S("NS"), position: "rightOf", text: "safety & <b> #1" },
        { id: "n2" as NoteId, target: S("c1"), position: "leftOf", text: "pick" },
      ],
    };
    await expectMermaidAccepts(stateToMermaid(ir));
  });

  it("parses `--` regions with per-region [*], block direction, block notes and self-transitions", async () => {
    const ir: StateIR = {
      kind: "state",
      states: [
        { id: S("state_start"), label: "", role: "start" },
        { id: S("Active"), label: "Active", role: "normal", direction: "LR" },
        { id: S("state_start_Active"), label: "", role: "start", parent: S("Active") },
        { id: S("NumOff"), label: "NumOff", role: "normal", parent: S("Active") },
        { id: S("NumOn"), label: "Num & <on> #", role: "normal", parent: S("Active") },
        { id: S("state_start_Active_r1"), label: "", role: "start", parent: S("Active"), region: 1 },
        { id: S("CapsOff"), label: "CapsOff", role: "normal", parent: S("Active"), region: 1 },
        { id: S("state_end_Active_r1"), label: "", role: "end", parent: S("Active"), region: 1 },
        { id: S("Scroll"), label: "Scroll", role: "normal", parent: S("Active"), region: 2 },
      ],
      transitions: [
        { id: "t1" as TransitionId, from: S("state_start"), to: S("Active") },
        { id: "t2" as TransitionId, from: S("state_start_Active"), to: S("NumOff") },
        { id: "t3" as TransitionId, from: S("NumOff"), to: S("NumOn"), label: "press" },
        { id: "t4" as TransitionId, from: S("state_start_Active_r1"), to: S("CapsOff") },
        { id: "t5" as TransitionId, from: S("CapsOff"), to: S("state_end_Active_r1") },
        { id: "t6" as TransitionId, from: S("Scroll"), to: S("Scroll"), label: "tick" },
      ],
      notes: [{ id: "n1" as NoteId, target: S("Active"), position: "rightOf", text: 'line <1> #\nline "2"' }],
    };
    const code = stateToMermaid(ir);
    expect(code).toContain("    --\n");
    expect(code).toContain("  end note\n");
    await expectMermaidAccepts(code);
  });
});

describe("mermaid.js accepts generated user journeys", () => {
  it("parses title, sections, tasks with and without actors, and an implicit first section", async () => {
    const ir: JourneyIR = {
      kind: "journey",
      title: "My working day & more",
      sections: [
        { id: "s0" as SectionId, name: "", tasks: [{ id: "t0" as TaskId, name: "Wake up", score: 2, actors: [] }] },
        {
          id: "s1" as SectionId,
          name: "Go to work",
          tasks: [
            { id: "t1" as TaskId, name: "Make tea", score: 5, actors: ["Me"] },
            { id: "t2" as TaskId, name: "Do work (hard)", score: 1, actors: ["Me", "Cat"] },
          ],
        },
        { id: "s2" as SectionId, name: "日本語 section", tasks: [{ id: "t3" as TaskId, name: "帰る", score: 4, actors: ["私"] }] },
      ],
    };
    await expectMermaidAccepts(journeyToMermaid(ir));
  });
});

describe("mermaid.js accepts generated requirement diagrams", () => {
  it("parses every requirement type, risk, verify method and relation type", async () => {
    const ir: RequirementIR = {
      kind: "requirement",
      requirements: [
        { id: Q("test_req"), name: "test_req", type: "requirement", reqId: "1", text: "the test text.", risk: "High", verifyMethod: "Test" },
        { id: Q("r2"), name: "r2", type: "functionalRequirement", reqId: "1.1", risk: "Low", verifyMethod: "Inspection" },
        { id: Q("r3"), name: "r3", type: "performanceRequirement", risk: "Medium", verifyMethod: "Demonstration" },
        { id: Q("r4"), name: "r4", type: "interfaceRequirement", verifyMethod: "Analysis" },
        { id: Q("r5"), name: "r5", type: "physicalRequirement" },
        { id: Q("r6"), name: "r6", type: "designConstraint" },
      ],
      elements: [
        { id: EL("test_entity"), name: "test_entity", type: "simulation" },
        { id: EL("e2"), name: "e2", type: "word doc", docRef: "reqs/test_entity" },
      ],
      relations: [
        { id: "x1" as RelationId, from: EL("test_entity"), to: Q("r2"), type: "satisfies" },
        { id: "x2" as RelationId, from: Q("test_req"), to: Q("r2"), type: "traces" },
        { id: "x3" as RelationId, from: Q("test_req"), to: Q("r3"), type: "contains" },
        { id: "x4" as RelationId, from: Q("r3"), to: Q("r4"), type: "derives" },
        { id: "x5" as RelationId, from: Q("r4"), to: Q("r5"), type: "refines" },
        { id: "x6" as RelationId, from: EL("e2"), to: Q("r6"), type: "copies" },
        { id: "x7" as RelationId, from: EL("e2"), to: Q("r5"), type: "verifies" },
      ],
    };
    await expectMermaidAccepts(requirementToMermaid(ir));
  });

  it("parses direction plus names and free text that must be quoted", async () => {
    const ir: RequirementIR = {
      kind: "requirement",
      direction: "LR",
      requirements: [
        // a name with spaces, and text carrying every character codegen escapes
        { id: Q("my req"), name: "my req", type: "requirement", reqId: "1.2, a", text: 'a: "quoted" > text & #hash\nsecond line', risk: "Low" },
        // a name that collides with a mermaid keyword must be quoted too
        { id: Q("element"), name: "element", type: "designConstraint" },
      ],
      elements: [{ id: EL("an entity"), name: "an entity", type: "test suite", docRef: "github.com/all_the_tests" }],
      relations: [
        { id: "x1" as RelationId, from: EL("an entity"), to: Q("my req"), type: "satisfies" },
        { id: "x2" as RelationId, from: Q("element"), to: Q("element"), type: "traces" },
      ],
    };
    await expectMermaidAccepts(requirementToMermaid(ir));
  });
});

describe("mermaid.js accepts generated gantt charts", () => {
  it("parses every diagram setting, tag, id and start/end form", async () => {
    const ir: GanttIR = {
      kind: "gantt",
      title: "Adding GANTT diagram functionality to mermaid",
      dateFormat: "YYYY-MM-DD",
      axisFormat: "%d/%m",
      tickInterval: "1week",
      excludes: ["weekends", "2014-01-10"],
      weekend: "friday",
      todayMarker: "stroke-width:5px,stroke:#0f0,opacity:0.5",
      inclusiveEndDates: true,
      sections: [
        {
          id: "s1" as SectionId,
          name: "A section",
          tasks: [
            { id: "t1" as TaskId, name: "Completed task", taskId: "des1", tags: ["done"], start: { kind: "date", value: "2014-01-06" }, end: { kind: "date", value: "2014-01-08" } },
            { id: "t2" as TaskId, name: "Active task", taskId: "des2", tags: ["active"], start: { kind: "date", value: "2014-01-09" }, end: { kind: "duration", value: "3d" } },
            { id: "t3" as TaskId, name: "Critical path", tags: ["crit", "done"], start: { kind: "after", ids: ["des1", "des2"] }, end: { kind: "duration", value: "2d" } },
            { id: "t4" as TaskId, name: "Add to mermaid", tags: [], start: { kind: "prev" }, end: { kind: "until", ids: ["isadded"] } },
            { id: "t5" as TaskId, name: "Functionality added", taskId: "isadded", tags: ["milestone"], start: { kind: "date", value: "2014-01-25" }, end: { kind: "duration", value: "0d" } },
            { id: "t6" as TaskId, name: "Deadline", taskId: "v1", tags: ["vert"], start: { kind: "date", value: "2014-01-28" }, end: { kind: "duration", value: "0d" } },
          ],
        },
      ],
    };
    await expectMermaidAccepts(ganttToMermaid(ir));
  });

  it("parses a bare chart, a nameless leading section and `todayMarker off`", async () => {
    await expectMermaidAccepts(ganttToMermaid({ kind: "gantt", sections: [] }));
    const ir: GanttIR = {
      kind: "gantt",
      todayMarker: "off",
      sections: [
        {
          id: "s0" as SectionId,
          name: "",
          tasks: [
            { id: "t1" as TaskId, name: "apple", taskId: "a", tags: [], start: { kind: "date", value: "2017-07-20" }, end: { kind: "duration", value: "1w" } },
            { id: "t2" as TaskId, name: "kiwi", taskId: "d", tags: [], start: { kind: "date", value: "2017-07-20" }, end: { kind: "until", ids: ["a"] } },
          ],
        },
      ],
    };
    await expectMermaidAccepts(ganttToMermaid(ir));
  });
});

describe("mermaid.js accepts generated timelines", () => {
  it("parses a title, sections, multi-event periods and a period without events", async () => {
    const ir: TimelineIR = {
      kind: "timeline",
      title: "History of Social Media Platform",
      sections: [
        {
          id: TS("s1"),
          name: "",
          periods: [
            { id: TP("p1"), label: "2002", events: [{ id: TE("e1"), text: "LinkedIn" }] },
            { id: TP("p2"), label: "2004", events: [{ id: TE("e2"), text: "Facebook" }, { id: TE("e3"), text: "Google" }] },
          ],
        },
        {
          id: TS("s2"),
          name: "21st century",
          periods: [
            // timeline text is RAW in mermaid, so these characters must reach
            // it unescaped; a period without events must parse too
            { id: TP("p3"), label: "Industry 4.0", events: [{ id: TE("e4"), text: 'Internet, "IoT" & <b>3D</b> #print\nsecond line' }] },
            { id: TP("p4"), label: "Industry 5.0", events: [] },
          ],
        },
        { id: TS("s3"), name: "未来", periods: [{ id: TP("p5"), label: "令和", events: [{ id: TE("e5"), text: "出来事" }] }] },
      ],
    };
    await expectMermaidAccepts(timelineToMermaid(ir));
  });

  it("parses a bare timeline and a title-only timeline", async () => {
    await expectMermaidAccepts(timelineToMermaid({ kind: "timeline", sections: [] }));
    await expectMermaidAccepts(timelineToMermaid({ kind: "timeline", title: "Just a title", sections: [] }));
  });
});

// The parsers accept non-ASCII letters and `.` in ids (mermaid does too);
// codegen emits ids verbatim, so the widened charset must survive a real parse.
describe("mermaid.js accepts generated diagrams with non-ASCII / dotted ids", () => {
  it("flowchart", async () => {
    const ir: FlowchartIR = {
      kind: "flowchart",
      direction: "LR",
      nodes: [
        { id: N("日本"), label: "日本語", shape: "rect" },
        { id: N("svc.api"), label: "api", shape: "rounded", parent: G("領域") },
      ],
      edges: [{ id: "e1" as EdgeId, from: N("日本"), to: N("svc.api"), line: "solid", headStart: "none", headEnd: "arrow", label: "呼ぶ" }],
      subgraphs: [{ id: G("領域"), label: "領域" }],
    };
    await expectMermaidAccepts(flowchartToMermaid(ir));
  });

  it("sequence", async () => {
    const ir: SequenceIR = {
      kind: "sequence",
      boxes: [],
      lifelines: [
        { id: L("ユーザ"), name: "User", kind: "actor" },
        { id: L("A.svc"), name: "A.svc", kind: "participant" },
      ],
      events: [
        { kind: "message", id: "m1" as MessageId, from: L("ユーザ"), to: L("A.svc"), label: "x", arrow: "solid" },
        { kind: "note", id: "n1" as NoteId, position: "over", lifelines: [L("ユーザ"), L("A.svc")], text: "n" },
      ],
    };
    await expectMermaidAccepts(sequenceToMermaid(ir));
  });

  it("state", async () => {
    const ir: StateIR = {
      kind: "state",
      states: [
        { id: S("日本"), label: "説明", role: "normal" },
        { id: S("svc.api"), label: "svc.api", role: "normal" },
      ],
      transitions: [{ id: "t1" as TransitionId, from: S("日本"), to: S("svc.api"), label: "go" }],
      notes: [{ id: "n1" as NoteId, target: S("svc.api"), position: "rightOf", text: "n" }],
    };
    await expectMermaidAccepts(stateToMermaid(ir));
  });
});
