// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import type {
  BranchId,
  ClassIR,
  ClassId,
  EdgeId,
  FlowchartIR,
  FragmentId,
  LifelineId,
  MessageId,
  NodeId,
  NoteId,
  RelationId,
  SequenceIR,
  StateIR,
  TransitionId,
} from "@gmermaid/ir";
import mermaid from "mermaid";
import { flowchartToMermaid } from "./flowchart";
import { classToMermaid } from "./classdiagram";
import { sequenceToMermaid } from "./sequence";
import { stateToMermaid } from "./statediagram";

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

describe("mermaid.js accepts generated flowcharts", () => {
  const base: FlowchartIR = {
    kind: "flowchart",
    direction: "TB",
    nodes: [
      { id: N("a"), label: "Start", shape: "rounded" },
      { id: N("b"), label: "Really? \"quoted\" & <b>html</b> #hash", shape: "diamond" },
      { id: N("c"), label: "multi\nline", shape: "stadium" },
    ],
    edges: [
      { id: "e1" as EdgeId, from: N("a"), to: N("b"), arrow: "arrow", label: "plain" },
      // the |"…"| form must survive labels containing the delimiter itself
      { id: "e2" as EdgeId, from: N("b"), to: N("c"), arrow: "dotted", label: "a|b | c" },
      { id: "e3" as EdgeId, from: N("c"), to: N("a"), arrow: "thick", label: 'quote " and #' },
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
      direction: "TB",
      nodes: shapes.map((shape, i) => ({ id: N(`n${i}`), label: `shape ${shape}`, shape })),
      edges: [
        { id: "e1" as EdgeId, from: N("n0"), to: N("n1"), arrow: "invisible" },
        { id: "e2" as EdgeId, from: N("n1"), to: N("n2"), arrow: "open", label: "still visible" },
      ],
    };
    await expectMermaidAccepts(flowchartToMermaid(ir));
  });

  it("parses edge labels containing pipes inside the |\"…\"| form", async () => {
    // isolate the pipe case so a failure names the actual suspect
    const ir: FlowchartIR = {
      ...base,
      nodes: base.nodes.slice(0, 2),
      edges: [{ id: "e2" as EdgeId, from: N("a"), to: N("b"), arrow: "arrow", label: "min|max" }],
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
      lifelines: [
        { id: L("a"), name: "Alice & <co> #1", isActor: true },
        { id: L("b"), name: "Bob", isActor: false },
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
      autonumber: { start: 10, step: 2 },
      lifelines: [
        { id: L("a"), name: "a", isActor: false },
        { id: L("b"), name: "b", isActor: false },
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
});

describe("mermaid.js accepts generated state diagrams", () => {
  it("parses [*] start/end, aliased states, labeled transitions and direction", async () => {
    const ir: StateIR = {
      kind: "state",
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
});
