import type {
  ActivationId,
  ActorId,
  BoundaryId,
  BoxId,
  BranchId,
  ClassId,
  ClassIR,
  DiagramIR,
  EdgeId,
  ElementId,
  EventId,
  FlowchartIR,
  FragmentId,
  GanttIR,
  JourneyIR,
  LifecycleId,
  LifelineId,
  MessageId,
  MindmapIR,
  MindmapNodeId,
  NamespaceId,
  NodeId,
  NoteId,
  PeriodId,
  RelationId,
  RequirementId,
  RequirementIR,
  SectionId,
  SequenceIR,
  StateId,
  StateIR,
  SubgraphId,
  TaskId,
  TimelineIR,
  TransitionId,
  UseCaseId,
  UsecaseIR,
  UsecaseRelationId,
} from "@gmermaid/ir";
import {
  emptyClassDiagram,
  emptyFlowchart,
  emptyGantt,
  emptyJourney,
  emptyMindmap,
  emptyRequirementDiagram,
  emptySequence,
  emptyStateDiagram,
  emptyTimeline,
  emptyUsecaseDiagram,
} from "@gmermaid/ir";

// One deliberately awkward diagram per kind — containers, references across
// them, and the elements whose closure rules are worth exercising — plus the
// selections the GUI can make over it.

const id = <T extends string>(s: string): T => s as T;

const flowchart: FlowchartIR = {
  kind: "flowchart",
  direction: "LR",
  nodes: [
    { id: id<NodeId>("nod_00000001"), label: "Start", shape: "stadium" },
    { id: id<NodeId>("nod_00000002"), label: "Inside", shape: "rect", parent: id<SubgraphId>("grp_00000001") },
    { id: id<NodeId>("nod_00000003"), label: "Deep", shape: "diamond", parent: id<SubgraphId>("grp_00000002") },
    { id: id<NodeId>("nod_00000004"), label: 'Quoted "x" & #hash', shape: "cylinder" },
  ],
  subgraphs: [
    { id: id<SubgraphId>("grp_00000001"), label: "Outer", direction: "TB" },
    { id: id<SubgraphId>("grp_00000002"), label: "Inner", parent: id<SubgraphId>("grp_00000001") },
  ],
  edges: [
    { id: id<EdgeId>("edg_00000001"), from: id<NodeId>("nod_00000001"), to: id<NodeId>("nod_00000002"), line: "solid", headStart: "none", headEnd: "arrow", label: "go" },
    { id: id<EdgeId>("edg_00000002"), from: id<NodeId>("nod_00000002"), to: id<NodeId>("nod_00000003"), line: "dotted", headStart: "none", headEnd: "arrow" },
    { id: id<EdgeId>("edg_00000003"), from: id<NodeId>("nod_00000004"), to: id<SubgraphId>("grp_00000001"), line: "thick", headStart: "none", headEnd: "circle" },
  ],
};

const sequence: SequenceIR = {
  kind: "sequence",
  lifelines: [
    { id: id<LifelineId>("lfl_00000001"), name: "Alice", kind: "actor" },
    { id: id<LifelineId>("lfl_00000002"), name: "Bob", kind: "participant" },
    { id: id<LifelineId>("lfl_00000003"), name: "DB", kind: "database" },
    { id: id<LifelineId>("lfl_00000004"), name: "Temp", kind: "participant" },
  ],
  boxes: [{ id: id<BoxId>("pbx_00000001"), name: "Service", color: "lightblue", lifelines: [id<LifelineId>("lfl_00000002"), id<LifelineId>("lfl_00000003")] }],
  events: [
    { kind: "message", id: id<MessageId>("msg_00000001"), from: id<LifelineId>("lfl_00000001"), to: id<LifelineId>("lfl_00000002"), label: "hello", arrow: "solid", activate: "start" },
    { kind: "note", id: id<NoteId>("nte_00000001"), position: "rightOf", lifelines: [id<LifelineId>("lfl_00000002")], text: "thinking" },
    {
      kind: "fragment",
      id: id<FragmentId>("frg_00000001"),
      fragmentKind: "alt",
      branches: [
        {
          id: id<BranchId>("brn_00000001"),
          condition: "found",
          events: [
            { kind: "message", id: id<MessageId>("msg_00000002"), from: id<LifelineId>("lfl_00000002"), to: id<LifelineId>("lfl_00000003"), label: "read", arrow: "solid" },
          ],
        },
        {
          id: id<BranchId>("brn_00000002"),
          condition: "missing",
          events: [
            { kind: "message", id: id<MessageId>("msg_00000003"), from: id<LifelineId>("lfl_00000002"), to: id<LifelineId>("lfl_00000001"), label: "sorry", arrow: "dotted" },
          ],
        },
      ],
    },
    { kind: "activation", id: id<ActivationId>("atv_00000001"), lifeline: id<LifelineId>("lfl_00000003"), on: true },
    { kind: "message", id: id<MessageId>("msg_00000004"), from: id<LifelineId>("lfl_00000003"), to: id<LifelineId>("lfl_00000002"), label: "rows", arrow: "dotted" },
    { kind: "activation", id: id<ActivationId>("atv_00000002"), lifeline: id<LifelineId>("lfl_00000003"), on: false },
    { kind: "message", id: id<MessageId>("msg_00000005"), from: id<LifelineId>("lfl_00000002"), to: id<LifelineId>("lfl_00000001"), label: "done", arrow: "dotted", activate: "end" },
    { kind: "create", id: id<LifecycleId>("lfc_00000001"), lifeline: id<LifelineId>("lfl_00000004") },
    { kind: "message", id: id<MessageId>("msg_00000006"), from: id<LifelineId>("lfl_00000002"), to: id<LifelineId>("lfl_00000004"), label: "spawn", arrow: "solid" },
    { kind: "destroy", id: id<LifecycleId>("lfc_00000002"), lifeline: id<LifelineId>("lfl_00000004") },
    { kind: "message", id: id<MessageId>("msg_00000008"), from: id<LifelineId>("lfl_00000002"), to: id<LifelineId>("lfl_00000004"), label: "gone", arrow: "cross" },
    // an activation opened at the top level and closed INSIDE a fragment:
    // copying the fragment alone must not take the `deactivate` with it
    { kind: "activation", id: id<ActivationId>("atv_00000003"), lifeline: id<LifelineId>("lfl_00000002"), on: true },
    {
      kind: "fragment",
      id: id<FragmentId>("frg_00000002"),
      fragmentKind: "opt",
      branches: [
        {
          id: id<BranchId>("brn_00000003"),
          condition: "tidy up",
          events: [
            { kind: "message", id: id<MessageId>("msg_00000007"), from: id<LifelineId>("lfl_00000002"), to: id<LifelineId>("lfl_00000001"), label: "bye", arrow: "solid" },
            { kind: "activation", id: id<ActivationId>("atv_00000004"), lifeline: id<LifelineId>("lfl_00000002"), on: false },
          ],
        },
      ],
    },
  ],
};

const classDiagram: ClassIR = {
  kind: "class",
  direction: "LR",
  namespaces: [{ id: id<NamespaceId>("nsp_00000001"), name: "Core" }],
  classes: [
    {
      id: id<ClassId>("cls_00000001"),
      name: "Shape",
      stereotypes: ["abstract"],
      attributes: [{ name: "sides", type: "int", visibility: "protected" }],
      methods: [{ name: "area", params: "", type: "float", visibility: "public", abstract: true }],
      namespace: id<NamespaceId>("nsp_00000001"),
    },
    {
      id: id<ClassId>("cls_00000002"),
      name: "Square",
      generic: "T",
      stereotypes: [],
      attributes: [{ name: "side", type: "int", visibility: "private", static: true }],
      methods: [],
      namespace: id<NamespaceId>("nsp_00000001"),
    },
    { id: id<ClassId>("cls_00000003"), name: "Canvas", label: "The Canvas", stereotypes: [], attributes: [], methods: [] },
  ],
  relations: [
    { id: id<RelationId>("rln_00000001"), from: id<ClassId>("cls_00000002"), to: id<ClassId>("cls_00000001"), line: "solid", headFrom: "none", headTo: "inheritance" },
    { id: id<RelationId>("rln_00000002"), from: id<ClassId>("cls_00000003"), to: id<ClassId>("cls_00000001"), line: "solid", headFrom: "none", headTo: "composition", label: "draws", toCardinality: "*" },
  ],
  notes: [
    { id: id<NoteId>("nte_00000001"), text: "the base", target: id<ClassId>("cls_00000001") },
    { id: id<NoteId>("nte_00000002"), text: "floating" },
  ],
};

const state: StateIR = {
  kind: "state",
  direction: "LR",
  states: [
    { id: id<StateId>("state_start"), label: "", role: "start" },
    { id: id<StateId>("stt_00000001"), label: "Idle", role: "normal" },
    { id: id<StateId>("stt_00000002"), label: "Working", role: "normal", direction: "TB" },
    { id: id<StateId>("stt_00000003"), label: "Fetching", role: "normal", parent: id<StateId>("stt_00000002") },
    { id: id<StateId>("stt_00000004"), label: "Parsing", role: "normal", parent: id<StateId>("stt_00000002") },
    { id: id<StateId>("state_start_stt_00000002"), label: "", role: "start", parent: id<StateId>("stt_00000002") },
    { id: id<StateId>("stt_00000005"), label: "", role: "choice" },
    { id: id<StateId>("state_end"), label: "", role: "end" },
  ],
  transitions: [
    { id: id<TransitionId>("trn_00000001"), from: id<StateId>("state_start"), to: id<StateId>("stt_00000001") },
    { id: id<TransitionId>("trn_00000002"), from: id<StateId>("stt_00000001"), to: id<StateId>("stt_00000002"), label: "GO" },
    { id: id<TransitionId>("trn_00000003"), from: id<StateId>("state_start_stt_00000002"), to: id<StateId>("stt_00000003") },
    { id: id<TransitionId>("trn_00000004"), from: id<StateId>("stt_00000003"), to: id<StateId>("stt_00000004") },
    { id: id<TransitionId>("trn_00000005"), from: id<StateId>("stt_00000002"), to: id<StateId>("stt_00000005") },
    { id: id<TransitionId>("trn_00000006"), from: id<StateId>("stt_00000005"), to: id<StateId>("state_end") },
  ],
  notes: [{ id: id<NoteId>("nte_00000001"), target: id<StateId>("stt_00000001"), position: "rightOf", text: "waiting here" }],
};

const requirement: RequirementIR = {
  kind: "requirement",
  direction: "LR",
  requirements: [
    { id: id<RequirementId>("rqm_00000001"), name: "top_req", type: "requirement", text: "the top one", reqId: "1", risk: "High", verifyMethod: "Test" },
    { id: id<RequirementId>("rqm_00000002"), name: "sub_req", type: "performanceRequirement", text: "faster" },
  ],
  elements: [{ id: id<ElementId>("elm_00000001"), name: "test_entity", type: "simulation", docRef: "docs/x.md" }],
  relations: [
    { id: id<RelationId>("rln_00000001"), from: id<RequirementId>("rqm_00000001"), to: id<RequirementId>("rqm_00000002"), type: "contains" },
    { id: id<RelationId>("rln_00000002"), from: id<ElementId>("elm_00000001"), to: id<RequirementId>("rqm_00000002"), type: "verifies" },
  ],
};

const usecase: UsecaseIR = {
  kind: "usecase",
  direction: "LR",
  actors: [
    { id: id<ActorId>("atr_00000001"), name: "Customer", variant: "default" },
    { id: id<ActorId>("atr_00000002"), name: "Admin", variant: "hollow", boundary: id<BoundaryId>("bnd_00000001") },
  ],
  usecases: [
    { id: id<UseCaseId>("ucs_00000001"), name: "Order", label: "Place an order", shape: "ellipse", boundary: id<BoundaryId>("bnd_00000001") },
    { id: id<UseCaseId>("ucs_00000002"), name: "Pay", shape: "rect" },
  ],
  boundaries: [{ id: id<BoundaryId>("bnd_00000001"), name: "Shop", label: "The Shop", type: "package" }],
  relations: [
    { id: id<UsecaseRelationId>("ucr_00000001"), from: id<ActorId>("atr_00000001"), to: id<UseCaseId>("ucs_00000001"), line: "solid", headFrom: "none", headTo: "arrow", label: "places" },
    { id: id<UsecaseRelationId>("ucr_00000002"), from: id<UseCaseId>("ucs_00000001"), to: id<UseCaseId>("ucs_00000002"), line: "dashed", headFrom: "none", headTo: "none", kind: "include" },
  ],
  notes: [{ id: id<NoteId>("nte_00000001"), target: id<UseCaseId>("ucs_00000002"), text: "card only" }],
};

const journey: JourneyIR = {
  kind: "journey",
  title: "My day",
  sections: [
    {
      id: id<SectionId>("sct_00000001"),
      name: "",
      tasks: [{ id: id<TaskId>("tsk_00000001"), name: "Wake up", score: 3, actors: ["Me"] }],
    },
    {
      id: id<SectionId>("sct_00000002"),
      name: "Work",
      tasks: [
        { id: id<TaskId>("tsk_00000002"), name: "Commute", score: 1, actors: ["Me", "Bus"] },
        { id: id<TaskId>("tsk_00000003"), name: "Code", score: 5, actors: ["Me"] },
      ],
    },
  ],
};

const timeline: TimelineIR = {
  kind: "timeline",
  title: "History",
  sections: [
    {
      id: id<SectionId>("sct_00000001"),
      name: "",
      periods: [{ id: id<PeriodId>("prd_00000001"), label: "2002", events: [{ id: id<EventId>("evt_00000001"), text: "founded" }] }],
    },
    {
      id: id<SectionId>("sct_00000002"),
      name: "Growth",
      periods: [
        {
          id: id<PeriodId>("prd_00000002"),
          label: "2004",
          events: [
            { id: id<EventId>("evt_00000002"), text: "hired" },
            { id: id<EventId>("evt_00000003"), text: "shipped" },
          ],
        },
        { id: id<PeriodId>("prd_00000003"), label: "2006", events: [] },
      ],
    },
  ],
};

const gantt: GanttIR = {
  kind: "gantt",
  title: "Plan",
  dateFormat: "YYYY-MM-DD",
  axisFormat: "%m-%d",
  sections: [
    {
      id: id<SectionId>("sct_00000001"),
      name: "",
      tasks: [{ id: id<TaskId>("tsk_00000001"), name: "Kickoff", taskId: "k1", tags: ["done"], start: { kind: "date", value: "2024-01-01" }, end: { kind: "duration", value: "3d" } }],
    },
    {
      id: id<SectionId>("sct_00000002"),
      name: "Build",
      tasks: [
        { id: id<TaskId>("tsk_00000002"), name: "Design", taskId: "d1", tags: ["active"], start: { kind: "after", ids: ["k1"] }, end: { kind: "duration", value: "5d" } },
        { id: id<TaskId>("tsk_00000003"), name: "Implement", taskId: "i1", tags: [], start: { kind: "after", ids: ["d1"] }, end: { kind: "duration", value: "10d" } },
        { id: id<TaskId>("tsk_00000004"), name: "Ship", tags: ["milestone"], start: { kind: "prev" }, end: { kind: "duration", value: "0d" } },
      ],
    },
  ],
};

const mindmap: MindmapIR = {
  kind: "mindmap",
  nodes: [
    { id: id<MindmapNodeId>("mmn_00000001"), label: "Root", shape: "circle" },
    { id: id<MindmapNodeId>("mmn_00000002"), label: "Left", shape: "default", parent: id<MindmapNodeId>("mmn_00000001") },
    { id: id<MindmapNodeId>("mmn_00000003"), label: "Right", shape: "cloud", parent: id<MindmapNodeId>("mmn_00000001"), icon: "fa fa-book" },
    { id: id<MindmapNodeId>("mmn_00000004"), label: "Leaf", shape: "rounded", parent: id<MindmapNodeId>("mmn_00000003") },
  ],
};

export interface Fixture {
  readonly name: string;
  readonly ir: DiagramIR;
  /** An empty diagram of the same kind carrying the SAME diagram-level
   * settings: paste deliberately never touches those, so a round-trip test
   * has to start from a target that already agrees about them. */
  readonly empty: DiagramIR;
  /** [label, selected ids] — every one is a selection the GUI can make. */
  readonly selections: readonly (readonly [string, readonly string[]])[];
}

export const FIXTURES: readonly Fixture[] = [
  {
    name: "flowchart",
    ir: flowchart,
    empty: emptyFlowchart("LR"),
    selections: [
      ["everything", [...flowchart.nodes.map((n) => n.id), ...flowchart.subgraphs.map((s) => s.id), ...flowchart.edges.map((e) => e.id)]],
      ["one node", ["nod_00000001"]],
      ["an edge alone", ["edg_00000001"]],
      ["an edge onto a subgraph", ["edg_00000003"]],
      ["the outer subgraph", ["grp_00000001"]],
      ["a node out of its group", ["nod_00000003"]],
      ["two nodes with wiring between them", ["nod_00000002", "nod_00000003"]],
    ],
  },
  {
    name: "sequence",
    ir: sequence,
    empty: emptySequence(),
    selections: [
      [
        "everything",
        [
          ...sequence.lifelines.map((l) => l.id),
          "msg_00000001", "nte_00000001", "frg_00000001", "atv_00000001", "msg_00000004", "atv_00000002", "msg_00000005",
          "lfc_00000001", "msg_00000006", "lfc_00000002", "msg_00000008", "atv_00000003", "frg_00000002",
        ],
      ],
      ["one message", ["msg_00000001"]],
      ["a message inside a fragment", ["msg_00000002"]],
      ["the whole fragment", ["frg_00000001"]],
      ["a branch", ["brn_00000002"]],
      ["a note", ["nte_00000001"]],
      ["a lifeline alone", ["lfl_00000003"]],
      ["a box", ["pbx_00000001"]],
      ["an unbalanced deactivate", ["atv_00000002", "msg_00000004"]],
      ["a fragment closing an activation opened outside it", ["frg_00000002"]],
      ["a whole lifecycle", ["lfc_00000001", "msg_00000006", "lfc_00000002", "msg_00000008"]],
    ],
  },
  {
    name: "class",
    ir: classDiagram,
    empty: { ...emptyClassDiagram(), direction: "LR" },
    selections: [
      ["everything", [...classDiagram.classes.map((c) => c.id), ...classDiagram.namespaces.map((n) => n.id), ...classDiagram.relations.map((r) => r.id), ...classDiagram.notes.map((n) => n.id)]],
      ["one class", ["cls_00000003"]],
      ["a relation alone", ["rln_00000001"]],
      ["a namespace", ["nsp_00000001"]],
      ["a class out of its namespace", ["cls_00000002"]],
      ["a note alone", ["nte_00000001"]],
      ["a floating note", ["nte_00000002"]],
    ],
  },
  {
    name: "state",
    ir: state,
    empty: { ...emptyStateDiagram(), direction: "LR" },
    selections: [
      ["everything", [...state.states.map((s) => s.id), ...state.transitions.map((t) => t.id), ...state.notes.map((n) => n.id)]],
      ["one leaf", ["stt_00000001"]],
      ["the composite", ["stt_00000002"]],
      ["a state inside a composite", ["stt_00000003"]],
      ["a transition alone", ["trn_00000002"]],
      ["both [*] promoted together", ["stt_00000003", "state_start", "state_start_stt_00000002"]],
      ["a choice", ["stt_00000005", "trn_00000006"]],
      ["a note", ["nte_00000001"]],
    ],
  },
  {
    name: "requirement",
    ir: requirement,
    empty: { ...emptyRequirementDiagram(), direction: "LR" },
    selections: [
      ["everything", [...requirement.requirements.map((r) => r.id), ...requirement.elements.map((e) => e.id), ...requirement.relations.map((r) => r.id)]],
      ["one requirement", ["rqm_00000001"]],
      ["one element", ["elm_00000001"]],
      ["a relation alone", ["rln_00000002"]],
    ],
  },
  {
    name: "usecase",
    ir: usecase,
    empty: { ...emptyUsecaseDiagram(), direction: "LR" },
    selections: [
      ["everything", [...usecase.actors.map((a) => a.id), ...usecase.usecases.map((u) => u.id), ...usecase.boundaries.map((b) => b.id), ...usecase.relations.map((r) => r.id), ...usecase.notes.map((n) => n.id)]],
      ["one actor", ["atr_00000001"]],
      ["the boundary", ["bnd_00000001"]],
      ["a member out of its boundary", ["ucs_00000001"]],
      ["a relation alone", ["ucr_00000001"]],
      ["an include relation", ["ucr_00000002"]],
      ["a note", ["nte_00000001"]],
    ],
  },
  {
    name: "journey",
    ir: journey,
    empty: emptyJourney(),
    selections: [
      ["everything", journey.sections.map((s) => s.id)],
      ["one task", ["tsk_00000003"]],
      ["a task in the unnamed section", ["tsk_00000001"]],
      ["a named section", ["sct_00000002"]],
    ],
  },
  {
    name: "timeline",
    ir: timeline,
    empty: emptyTimeline(),
    selections: [
      ["everything", timeline.sections.map((s) => s.id)],
      ["one event", ["evt_00000002"]],
      ["one period", ["prd_00000002"]],
      ["an eventless period", ["prd_00000003"]],
      ["a named section", ["sct_00000002"]],
    ],
  },
  {
    name: "gantt",
    ir: gantt,
    empty: { ...emptyGantt(), dateFormat: "YYYY-MM-DD", axisFormat: "%m-%d" },
    selections: [
      ["everything", gantt.sections.map((s) => s.id)],
      ["a task with a dependency", ["tsk_00000003"]],
      ["a task with no id", ["tsk_00000004"]],
      ["a named section", ["sct_00000002"]],
    ],
  },
  {
    name: "mindmap",
    ir: mindmap,
    empty: emptyMindmap(),
    selections: [
      ["everything", mindmap.nodes.map((n) => n.id)],
      ["the root", ["mmn_00000001"]],
      ["a subtree", ["mmn_00000003"]],
      ["a leaf", ["mmn_00000004"]],
    ],
  },
];
