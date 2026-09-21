import type { ClassIR, FlowchartIR, JourneyIR, MindmapIR, RequirementIR, SequenceIR, StateIR, TimelineIR } from "@gmermaid/ir";
import { parseClassDiagram } from "./classdiagram";
import { firstStatement, type ParseResult } from "./common";
import { parseFlowchart } from "./flowchart";
import { parseJourney } from "./journey";
import { parseMindmap } from "./mindmap";
import { parseRequirementDiagram } from "./requirement";
import { parseSequence } from "./sequence";
import { parseStateDiagram } from "./statediagram";
import { parseTimeline } from "./timeline";

// One place that knows every diagram kind gMermaid supports. Adding a
// diagram = add it here, then register its editor in packages/app.

export const DIAGRAM_KINDS = ["flowchart", "sequence", "class", "state", "requirement", "journey", "timeline", "mindmap"] as const;
export type DiagramKind = (typeof DIAGRAM_KINDS)[number];

export type AnyIR = FlowchartIR | SequenceIR | ClassIR | StateIR | RequirementIR | JourneyIR | TimelineIR | MindmapIR;

/** Header keyword(s) that open each diagram kind, in mermaid text. */
const HEADERS: Record<DiagramKind, readonly string[]> = {
  flowchart: ["flowchart", "graph"],
  sequence: ["sequenceDiagram"],
  class: ["classDiagram"],
  state: ["stateDiagram"],
  timeline: ["timeline"],
  journey: ["journey"],
  requirement: ["requirementDiagram"],
  mindmap: ["mindmap"],
};

export function detectDiagramKind(code: string): DiagramKind | undefined {
  const head = firstStatement(code) ?? "";
  for (const kind of DIAGRAM_KINDS) {
    if (HEADERS[kind].some((h) => head.startsWith(h))) return kind;
  }
  return undefined;
}

export function parseDiagram(kind: DiagramKind, code: string): ParseResult<AnyIR> {
  switch (kind) {
    case "flowchart":
      return parseFlowchart(code);
    case "sequence":
      return parseSequence(code);
    case "class":
      return parseClassDiagram(code);
    case "state":
      return parseStateDiagram(code);
    case "timeline":
      return parseTimeline(code);
    case "journey":
      return parseJourney(code);
    case "requirement":
      return parseRequirementDiagram(code);
    case "mindmap":
      return parseMindmap(code);
  }
}
