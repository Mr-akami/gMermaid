// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import {
  applyClassAction,
  applyFlowchartAction,
  applyGanttAction,
  applyJourneyAction,
  applyMindmapAction,
  applyRequirementAction,
  applySequenceAction,
  applyStateAction,
  applyTimelineAction,
  applyUsecaseAction,
  emptyClassDiagram,
  emptyFlowchart,
  emptyRequirementDiagram,
  findEventPosition,
  mindmapRoot,
  newId,
  newSectionId,
  newStateId,
  newTaskId,
  type EventId,
  type MindmapNodeId,
  type SectionId,
} from "@gmermaid/ir";
import {
  parseFlowchart,
  parseGantt,
  parseJourney,
  parseMindmap,
  parseSequence,
  parseStateDiagram,
  parseTimeline,
  parseUsecase,
  DIAGRAM_KINDS,
  FLOWCHART_RESERVED_IDS,
  SEQUENCE_RESERVED_IDS,
  STATE_RESERVED_IDS,
  type DiagramKind,
} from "@gmermaid/mermaid-parser";
import mermaid from "mermaid";
import { classToMermaid } from "./classdiagram";
import { flowchartToMermaid } from "./flowchart";
import { ganttToMermaid } from "./gantt";
import { journeyToMermaid } from "./journey";
import { mindmapToMermaid } from "./mindmap";
import { requirementToMermaid } from "./requirement";
import { sequenceToMermaid } from "./sequence";
import { stateToMermaid } from "./statediagram";
import { timelineToMermaid } from "./timeline";
import { usecaseToMermaid } from "./usecase";

// C4, one layer below mermaid-integration.test.ts: that file proves hand
// written IRs (friendly ids like `a`, `t1`) survive mermaid.js. Nothing
// proved it for an IR shaped the way the GUI actually builds one — same
// `newId(…)` calls, same reducer actions the toolbar buttons dispatch — and
// that is exactly where `subgraph-<hex>` ids slipped through: a generated id
// that spells a mermaid keyword. Every case here therefore MINTS its ids.

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false });
});

async function expectMermaidAccepts(code: string): Promise<void> {
  await expect(mermaid.parse(code), code).resolves.toBeTruthy();
}

/** The cases one diagram kind contributes: name → mermaid text. */
type Cases = Record<string, string>;

// ---------------------------------------------------------------- flowchart

function flowchartCases(): Cases {
  // mirrors FlowchartEditor.initialIR()
  const sampleA = newId("node");
  const sampleB = newId("node");
  let sample = emptyFlowchart("TB");
  sample = applyFlowchartAction(sample, { type: "addNode", node: { id: sampleA, label: "Start", shape: "rounded" } });
  sample = applyFlowchartAction(sample, { type: "addNode", node: { id: sampleB, label: "End", shape: "rounded" } });
  sample = applyFlowchartAction(sample, { type: "addEdge", id: newId("edge"), from: sampleA, to: sampleB });

  // mirrors addNode() / addSubgraph() / handleConnectDrop()
  let built = sample;
  const n1 = newId("node");
  const n2 = newId("node");
  built = applyFlowchartAction(built, { type: "addNode", node: { id: n1, label: "Node", shape: "rect" } });
  built = applyFlowchartAction(built, { type: "addNode", node: { id: n2, label: "Node", shape: "rect" } });
  built = applyFlowchartAction(built, { type: "addEdge", id: newId("edge"), from: n1, to: n2 });

  // a subgraph with a child, and an edge whose endpoint IS the subgraph
  const group = newId("subgraph");
  const child = newId("node");
  let container = built;
  container = applyFlowchartAction(container, { type: "addSubgraph", subgraph: { id: group, label: "Group 1" } });
  container = applyFlowchartAction(container, { type: "addNode", node: { id: child, label: "Node", shape: "rect", parent: group } });
  container = applyFlowchartAction(container, { type: "addEdge", id: newId("edge"), from: n1, to: group });

  return {
    sample: flowchartToMermaid(sample),
    "toolbar adds + connection": flowchartToMermaid(built),
    "subgraph with a child, edge to the subgraph": flowchartToMermaid(container),
  };
}

// ----------------------------------------------------------------- sequence

const SEQUENCE_SAMPLE = `sequenceDiagram
  actor user as User
  box rgb(226,236,250) Service
    participant app as App
    participant api as API
  end
  user->>app: login
  app->>+api: authenticate
  alt success
    api-->>-app: token
  end
`;

function sequenceCases(): Cases {
  const parsed = parseSequence(SEQUENCE_SAMPLE);
  if (!parsed.ok) throw new Error("sequence sample does not parse");
  const sample = parsed.ir;

  // mirrors addLifeline() + handleElementClick()'s message creation
  let built = sample;
  const l1 = newId("lifeline");
  const l2 = newId("lifeline");
  built = applySequenceAction(built, { type: "addLifeline", lifeline: { id: l1, name: "Participant", kind: "participant" } });
  built = applySequenceAction(built, { type: "addLifeline", lifeline: { id: l2, name: "Participant", kind: "participant" } });
  const msg = newId("message");
  built = applySequenceAction(built, {
    type: "addMessage",
    message: { kind: "message", id: msg, from: l1, to: l2, label: "message", arrow: "solid" },
  });
  // mirrors addNote() with a message selected
  const pos = findEventPosition(built, msg);
  if (!pos) throw new Error("added message not found");
  built = applySequenceAction(built, {
    type: "addEventAt",
    event: { kind: "note", id: newId("note"), position: "over", lifelines: [l1, l2], text: "note" },
    container: pos.container,
    index: pos.index + 1,
  });
  // mirrors the lifecycle toggles in the property window
  built = applySequenceAction(built, { type: "setLifecycle", lifeline: l2, which: "create", eventId: newId("lifecycle"), on: true });

  // containers: a box around a lifeline, a fragment around a message
  let container = built;
  container = applySequenceAction(container, { type: "addBox", box: { id: newId("box"), name: "Group", lifelines: [l1] } });
  const fragmentId = newId("fragment");
  container = applySequenceAction(container, {
    type: "wrapInFragment",
    fragmentId,
    branchId: newId("branch"),
    fragmentKind: "alt",
    condition: "condition",
    eventIds: [msg],
  });
  container = applySequenceAction(container, { type: "addBranch", fragmentId, branchId: newId("branch"), condition: "" });

  return {
    sample: sequenceToMermaid(sample),
    "toolbar adds + message": sequenceToMermaid(built),
    "box and fragment around them": sequenceToMermaid(container),
  };
}

// -------------------------------------------------------------------- class

function classCases(): Cases {
  // mirrors ClassEditor.initialIR()
  const a = newId("class");
  const b = newId("class");
  let sample = emptyClassDiagram();
  sample = applyClassAction(sample, {
    type: "addClass",
    node: {
      id: a,
      name: "Animal",
      stereotypes: [],
      attributes: [{ name: "name", type: "String", visibility: "protected" }],
      methods: [{ name: "speak", params: "", type: "String", visibility: "public", abstract: true }],
    },
  });
  sample = applyClassAction(sample, { type: "addClass", node: { id: b, name: "Dog", stereotypes: [], attributes: [], methods: [] } });
  sample = applyClassAction(sample, {
    type: "addRelation",
    relation: { id: newId("relation"), from: a, to: b, line: "solid", headFrom: "inheritance", headTo: "none" },
  });

  // mirrors addClass() / addNote() / handleConnectDrop()
  let built = sample;
  const c1 = newId("class");
  const c2 = newId("class");
  built = applyClassAction(built, { type: "addClass", node: { id: c1, name: "NewClass1", stereotypes: [], attributes: [], methods: [] } });
  built = applyClassAction(built, { type: "addClass", node: { id: c2, name: "NewClass2", stereotypes: [], attributes: [], methods: [] } });
  built = applyClassAction(built, {
    type: "addRelation",
    relation: { id: newId("relation"), from: c1, to: c2, line: "solid", headFrom: "none", headTo: "arrow" },
  });
  built = applyClassAction(built, { type: "addNote", note: { id: newId("note"), text: "note", target: c1 } });

  // mirrors addNamespace(): born with its first member
  let container = built;
  container = applyClassAction(container, {
    type: "addNamespace",
    namespace: { id: newId("namespace"), name: "Namespace1" },
    classes: [c1],
  });

  return {
    sample: classToMermaid(sample),
    "toolbar adds + relation": classToMermaid(built),
    "namespace with a member, relation touching it": classToMermaid(container),
  };
}

// -------------------------------------------------------------------- state

const STATE_SAMPLE = `stateDiagram-v2
  [*] --> Still
  Still --> Moving : push
  state Moving {
    direction LR
    [*] --> Slow
    Slow --> Fast : accelerate
    --
    state Wipers
  }
  Moving --> Crash : collision
  Crash --> [*]
  note right of Crash : investigate!
`;

function stateCases(): Cases {
  const parsed = parseStateDiagram(STATE_SAMPLE);
  if (!parsed.ok) throw new Error("state sample does not parse");
  const sample = parsed.ir;

  // mirrors addState() / addPseudo() / addSpecial() / addNote() / connect()
  let built = sample;
  const s1 = newStateId();
  const s2 = newStateId();
  built = applyStateAction(built, { type: "addState", state: { id: s1, label: "NewState1", role: "normal" } });
  built = applyStateAction(built, { type: "addState", state: { id: s2, label: "NewState2", role: "normal" } });
  for (const role of ["choice", "fork", "join"] as const) {
    built = applyStateAction(built, { type: "addState", state: { id: newStateId(), label: "", role } });
  }
  built = applyStateAction(built, { type: "addTransition", transition: { id: newId("transition"), from: s1, to: s2 } });
  built = applyStateAction(built, {
    type: "addStateNote",
    note: { id: newId("note"), target: s1, position: "rightOf", text: "note" },
  });

  // composite: a state moved into another, plus a transition touching the
  // composite itself (that is what the canvas drop gesture produces)
  let container = built;
  const inner = newStateId();
  container = applyStateAction(container, { type: "addState", state: { id: inner, label: "NewState3", role: "normal" } });
  container = applyStateAction(container, { type: "setStateParent", id: inner, parent: s2 });
  container = applyStateAction(container, { type: "addTransition", transition: { id: newId("transition"), from: s1, to: s2 } });

  return {
    sample: stateToMermaid(sample),
    "toolbar adds + transition": stateToMermaid(built),
    "composite with a child, transition to the composite": stateToMermaid(container),
  };
}

// -------------------------------------------------------------- requirement

function requirementCases(): Cases {
  // mirrors RequirementEditor.initialIR()
  const req = newId("requirement");
  const elem = newId("element");
  let sample = emptyRequirementDiagram();
  sample = applyRequirementAction(sample, {
    type: "addRequirement",
    requirement: { id: req, name: "test_req", type: "requirement", reqId: "1", text: "the test text.", risk: "High", verifyMethod: "Test" },
  });
  sample = applyRequirementAction(sample, { type: "addElement", element: { id: elem, name: "test_entity", type: "simulation" } });
  sample = applyRequirementAction(sample, {
    type: "addRelation",
    relation: { id: newId("relation"), from: elem, to: req, type: "satisfies" },
  });

  // mirrors addRequirement() / addElement() / handleConnectDrop()
  let built = sample;
  const r2 = newId("requirement");
  const e2 = newId("element");
  built = applyRequirementAction(built, { type: "addRequirement", requirement: { id: r2, name: "new_req", type: "requirement" } });
  built = applyRequirementAction(built, { type: "addElement", element: { id: e2, name: "new_element" } });
  built = applyRequirementAction(built, {
    type: "addRelation",
    relation: { id: newId("relation"), from: e2, to: r2, type: "satisfies" },
  });

  return {
    sample: requirementToMermaid(sample),
    "toolbar adds + relation": requirementToMermaid(built),
  };
}

// ------------------------------------------------------------------ journey

const JOURNEY_SAMPLE = `journey
  title Sign up for the service
  section Discover
    Read the docs: 4: Visitor
    Compare plans: 3: Visitor
`;

function journeyCases(): Cases {
  const parsed = parseJourney(JOURNEY_SAMPLE);
  if (!parsed.ok) throw new Error("journey sample does not parse");
  const sample = parsed.ir;

  // mirrors addSection() / addTask()
  let built = sample;
  const section: SectionId = newId("section");
  built = applyJourneyAction(built, { type: "addSection", section: { id: section, name: "Section 2" } });
  built = applyJourneyAction(built, {
    type: "addTask",
    sectionId: section,
    task: { id: newId("task"), name: "Task 1", score: 3, actors: [] },
  });

  return {
    sample: journeyToMermaid(sample),
    "section with a task": journeyToMermaid(built),
  };
}

// ----------------------------------------------------------------- timeline

const TIMELINE_SAMPLE = `timeline
  title History of Social Media Platform
  2002 : LinkedIn
  2004 : Facebook : Google
`;

function timelineCases(): Cases {
  const parsed = parseTimeline(TIMELINE_SAMPLE);
  if (!parsed.ok) throw new Error("timeline sample does not parse");
  const sample = parsed.ir;

  // mirrors addSection() / addPeriod() / addEvent()
  let built = sample;
  const section: SectionId = newId("section");
  built = applyTimelineAction(built, { type: "addSection", section: { id: section, name: "Section 1", periods: [] } });
  const period = newId("period");
  built = applyTimelineAction(built, { type: "addPeriod", sectionId: section, period: { id: period, label: "Period 1", events: [] } });
  const event: EventId = newId("event");
  built = applyTimelineAction(built, { type: "addEvent", periodId: period, event: { id: event, text: "Event 1" } });

  return {
    sample: timelineToMermaid(sample),
    "section with a period and an event": timelineToMermaid(built),
  };
}

// -------------------------------------------------------------------- gantt

const GANTT_SAMPLE = `gantt
  title A Gantt Diagram
  dateFormat YYYY-MM-DD
  section Section
  A task :a1, 2014-01-01, 30d
  Another task :after a1, 20d
`;

function ganttCases(): Cases {
  const parsed = parseGantt(GANTT_SAMPLE);
  if (!parsed.ok) throw new Error("gantt sample does not parse");
  const sample = parsed.ir;

  // mirrors addSection() / addTask()
  let built = sample;
  const section = newSectionId();
  built = applyGanttAction(built, { type: "addSection", section: { id: section, name: "Section 2" } });
  built = applyGanttAction(built, {
    type: "addTask",
    sectionId: section,
    task: { id: newTaskId(), name: "Task 1", tags: [], start: { kind: "prev" }, end: { kind: "duration", value: "1d" } },
  });

  return {
    sample: ganttToMermaid(sample),
    "section with a task": ganttToMermaid(built),
  };
}

// ------------------------------------------------------------------ mindmap

const MINDMAP_SAMPLE = `mindmap
  root((mindmap))
    Origins
      Long history
    Research
      On Automatic creation
`;

function mindmapCases(): Cases {
  const parsed = parseMindmap(MINDMAP_SAMPLE);
  if (!parsed.ok) throw new Error("mindmap sample does not parse");
  const sample = parsed.ir;

  // mirrors addChild() / addSibling()
  let built = sample;
  const root = mindmapRoot(built);
  if (!root) throw new Error("mindmap sample has no root");
  const child: MindmapNodeId = newId("mindmapNode");
  built = applyMindmapAction(built, { type: "addNode", node: { id: child, label: "Node 1", shape: "default", parent: root.id } });
  const sibling: MindmapNodeId = newId("mindmapNode");
  built = applyMindmapAction(built, {
    type: "addNode",
    node: { id: sibling, label: "Node 2", shape: "default", parent: root.id },
    after: child,
  });

  return {
    sample: mindmapToMermaid(sample),
    "child and sibling": mindmapToMermaid(built),
  };
}

// ------------------------------------------------------------------ usecase

const USECASE_SAMPLE = `usecase-beta
direction LR
actor Customer("Customer")
systemBoundary storefront["Storefront"]@{ type: package }
  Browse("Browse catalogue")
  Checkout("Checkout")
end
Track("Track delivery")
Customer --> Browse
note for Checkout "validates the cart"
`;

function usecaseCases(): Cases {
  const parsed = parseUsecase(USECASE_SAMPLE);
  if (!parsed.ok) throw new Error("usecase sample does not parse");
  const sample = parsed.ir;

  // mirrors addActor() / addUseCase() / addBoundary() / addNote() / connect()
  let built = sample;
  const actor = newId("actor");
  const usecase = newId("usecase");
  built = applyUsecaseAction(built, { type: "addActor", actor: { id: actor, name: "Actor1", variant: "default" } });
  built = applyUsecaseAction(built, { type: "addUseCase", usecase: { id: usecase, name: "UseCase1", shape: "ellipse" } });
  built = applyUsecaseAction(built, {
    type: "addRelation",
    relation: { id: newId("usecaseRelation"), from: actor, to: usecase, line: "solid", headFrom: "none", headTo: "arrow" },
  });
  built = applyUsecaseAction(built, { type: "addNote", note: { id: newId("note"), target: usecase, text: "note" } });

  // a boundary with a member, and a relation touching that member
  let container = built;
  const boundary = newId("boundary");
  container = applyUsecaseAction(container, { type: "addBoundary", boundary: { id: boundary, name: "Boundary1", type: "default" } });
  container = applyUsecaseAction(container, { type: "setNodeBoundary", id: usecase, boundary });

  return {
    sample: usecaseToMermaid(sample),
    "toolbar adds + relation": usecaseToMermaid(built),
    "boundary with a member, relation touching it": usecaseToMermaid(container),
  };
}

// A flowchart saved before ID_PREFIX existed: our own parser reads these ids
// happily, so the editor opens the file — and then emits text mermaid cannot
// read. Importing repairs it, so re-saving fixes the file for good.
const LEGACY_FLOWCHART = `flowchart TB
  node-e455cb6b("Start")
  subgraph subgraph-a6bde494["Group 1"]
    node-1b2c3d4e["Inside"]
  end
  node-e455cb6b --> node-1b2c3d4e
  node-e455cb6b --> subgraph-a6bde494
`;

describe("a diagram saved with the old ids", () => {
  it("is invalid mermaid as it stands", async () => {
    await expect(mermaid.parse(LEGACY_FLOWCHART)).rejects.toThrow();
  });

  it("opens, is repaired, and comes back mermaid-valid", async () => {
    const parsed = parseFlowchart(LEGACY_FLOWCHART);
    if (!parsed.ok) throw new Error("the old file no longer opens");
    const ir = parsed.ir;

    // the subgraph is renamed; every reference follows it
    const group = ir.subgraphs[0]!;
    expect(group.id).toBe("grp_a6bde494");
    expect(group.label).toBe("Group 1");
    expect(ir.nodes.find((n) => n.parent !== undefined)?.parent).toBe(group.id);
    expect(ir.edges.map((e) => e.to)).toContain(group.id);
    // the node ids read fine, so they are left exactly as the user's file has them
    expect(ir.nodes.map((n) => n.id)).toEqual(["node-e455cb6b", "node-1b2c3d4e"]);
    // and the rename is said out loud rather than done behind the user's back
    expect(parsed.warnings.map((w) => w.message).join("\n")).toContain("renamed to `grp_a6bde494`");

    await expectMermaidAccepts(flowchartToMermaid(ir));
  });
});

// The other direction: an id the USER types. Generated ids are ours to keep
// safe, but the code pane accepts hand-written text, and mermaid's grammars
// claim some words before they ever look for an id. Those are refused at
// import with the reason shown — never rewritten, since the id is the user's.
const RESERVED_ID_CASES: readonly {
  readonly kind: string;
  readonly words: readonly string[];
  readonly text: (id: string) => string;
  readonly parse: (code: string) => { readonly ok: boolean; readonly errors?: readonly { readonly message: string }[] };
}[] = [
  {
    kind: "flowchart",
    words: FLOWCHART_RESERVED_IDS,
    text: (id) => `flowchart TB\n  ${id}["L"]\n  ${id} --> b\n`,
    parse: parseFlowchart,
  },
  {
    kind: "state",
    words: STATE_RESERVED_IDS,
    text: (id) => `stateDiagram-v2\n  state "L" as ${id}\n  ${id} --> b\n`,
    parse: parseStateDiagram,
  },
  {
    kind: "sequence",
    words: SEQUENCE_RESERVED_IDS,
    text: (id) => `sequenceDiagram\n  participant ${id} as L\n  ${id}->>b: hi\n`,
    parse: parseSequence,
  },
];

describe("ids a user types", () => {
  for (const { kind, words, text, parse } of RESERVED_ID_CASES) {
    describe(kind, () => {
      it.each(words)("`%s` is refused, with the reason", async (word) => {
        // the list is not a guess: mermaid itself cannot read the diagram
        await expect(mermaid.parse(text(word)), text(word)).rejects.toThrow();
        const result = parse(text(word));
        expect(result.ok, text(word)).toBe(false);
        expect(result.errors?.map((e) => e.message).join("\n")).toContain(`\`${word}\` is a mermaid keyword`);
      });
    });
  }
});

const CASES: Record<DiagramKind, () => Cases> = {
  flowchart: flowchartCases,
  sequence: sequenceCases,
  class: classCases,
  state: stateCases,
  requirement: requirementCases,
  journey: journeyCases,
  timeline: timelineCases,
  gantt: ganttCases,
  mindmap: mindmapCases,
  usecase: usecaseCases,
};

describe("mermaid.js accepts what the editors build", () => {
  // every kind is covered, so a new diagram kind cannot slip past this file
  it("covers every diagram kind", () => {
    expect(Object.keys(CASES).toSorted()).toEqual([...DIAGRAM_KINDS].toSorted());
  });

  for (const kind of DIAGRAM_KINDS) {
    describe(kind, () => {
      for (const [name, code] of Object.entries(CASES[kind]())) {
        it(name, async () => {
          await expectMermaidAccepts(code);
        });
      }
    });
  }
});
