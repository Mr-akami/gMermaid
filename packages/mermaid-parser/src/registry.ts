import type { ClassIR, FlowchartIR, SequenceIR, StateIR } from "@gmermaid/ir";
import { parseClassDiagram } from "./classdiagram";
import type { ParseResult } from "./common";
import { parseFlowchart } from "./flowchart";
import { parseSequence } from "./sequence";
import { parseStateDiagram } from "./statediagram";

// One place that knows every diagram kind gMermaid supports. Adding a
// diagram = add it here, then register its editor in packages/app.

export const DIAGRAM_KINDS = ["flowchart", "sequence", "class", "state"] as const;
export type DiagramKind = (typeof DIAGRAM_KINDS)[number];

export type AnyIR = FlowchartIR | SequenceIR | ClassIR | StateIR;

/** Header keyword(s) that open each diagram kind, in mermaid text. */
const HEADERS: Record<DiagramKind, readonly string[]> = {
  flowchart: ["flowchart", "graph"],
  sequence: ["sequenceDiagram"],
  class: ["classDiagram"],
  state: ["stateDiagram"],
};

/** First non-empty line that is not a `%%` comment / directive or part of a
 * leading `---` frontmatter block. */
export function headerLine(code: string): string {
  const lines = code.split("\n");
  let i = 0;
  // frontmatter
  while (i < lines.length && lines[i]!.trim() === "") i++;
  if (lines[i]?.trim() === "---") {
    i++;
    while (i < lines.length && lines[i]!.trim() !== "---") i++;
    i++;
  }
  for (; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (t === "" || t.startsWith("%%")) continue;
    return t;
  }
  return "";
}

export function detectDiagramKind(code: string): DiagramKind | undefined {
  const head = headerLine(code);
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
  }
}
