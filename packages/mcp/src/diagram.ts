import type { ClassIR, FlowchartIR, GanttIR, JourneyIR, MindmapIR, RequirementIR, SequenceIR, StateIR, TimelineIR, UsecaseIR } from "@gmermaid/ir";
import {
  classToMermaid,
  flowchartToMermaid,
  ganttToMermaid,
  journeyToMermaid,
  mindmapToMermaid,
  requirementToMermaid,
  sequenceToMermaid,
  stateToMermaid,
  timelineToMermaid,
  usecaseToMermaid,
} from "@gmermaid/mermaid-codegen";
import { DIAGRAM_KINDS, detectDiagramKind, parseDiagram, type DiagramKind } from "@gmermaid/mermaid-parser";

export { DIAGRAM_KINDS };
export type { DiagramKind };

export const MAX_MERMAID_BYTES = 256 * 1024;

export type DiagramValidation =
  | { readonly ok: true; readonly kind: DiagramKind }
  | { readonly ok: false; readonly message: string };

export function detectKind(mermaid: string): DiagramKind | undefined {
  return detectDiagramKind(mermaid);
}

export function validateDiagram(mermaid: string, expectedKind?: DiagramKind): DiagramValidation {
  if (new TextEncoder().encode(mermaid).byteLength > MAX_MERMAID_BYTES) {
    return { ok: false, message: `Mermaid input exceeds ${MAX_MERMAID_BYTES} bytes` };
  }
  const kind = detectKind(mermaid);
  if (kind === undefined) {
    return { ok: false, message: `Supported diagrams: ${DIAGRAM_KINDS.join(", ")}` };
  }
  if (expectedKind !== undefined && kind !== expectedKind) {
    return { ok: false, message: `Diagram kind cannot change from ${expectedKind} to ${kind}` };
  }
  const parsed = parseDiagram(kind, mermaid);
  if (parsed.ok) return { ok: true, kind };
  return { ok: false, message: parsed.errors.map((error) => `line ${error.line}: ${error.message}`).join("\n") };
}

/** The text the editor would write back for `mermaid`: parse, then generate.
 * Undefined when it does not parse. Two texts with the same canonical form
 * are the same diagram as far as the editor can tell. */
export function canonicalMermaid(mermaid: string): string | undefined {
  const kind = detectKind(mermaid);
  if (kind === undefined) return undefined;
  const parsed = parseDiagram(kind, mermaid);
  if (!parsed.ok) return undefined;
  const ir = parsed.ir;
  switch (kind) {
    case "flowchart":
      return flowchartToMermaid(ir as FlowchartIR);
    case "sequence":
      return sequenceToMermaid(ir as SequenceIR);
    case "class":
      return classToMermaid(ir as ClassIR);
    case "state":
      return stateToMermaid(ir as StateIR);
    case "requirement":
      return requirementToMermaid(ir as RequirementIR);
    case "journey":
      return journeyToMermaid(ir as JourneyIR);
    case "timeline":
      return timelineToMermaid(ir as TimelineIR);
    case "gantt":
      return ganttToMermaid(ir as GanttIR);
    case "mindmap":
      return mindmapToMermaid(ir as MindmapIR);
    case "usecase":
      return usecaseToMermaid(ir as UsecaseIR);
  }
}
