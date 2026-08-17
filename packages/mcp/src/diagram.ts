import { parseClassDiagram, parseFlowchart, parseSequence, parseStateDiagram } from "@gmermaid/mermaid-parser";
import type { DiagramKind } from "@gmermaid/app/review";

export const MAX_MERMAID_BYTES = 256 * 1024;

export type DiagramValidation =
  | { readonly ok: true; readonly kind: DiagramKind }
  | { readonly ok: false; readonly message: string };

export function detectKind(mermaid: string): DiagramKind | undefined {
  const head = mermaid.trimStart();
  if (head.startsWith("flowchart") || head.startsWith("graph")) return "flowchart";
  if (head.startsWith("sequenceDiagram")) return "sequence";
  if (head.startsWith("classDiagram")) return "class";
  if (head.startsWith("stateDiagram")) return "state";
  return undefined;
}

export function validateDiagram(mermaid: string, expectedKind?: DiagramKind): DiagramValidation {
  if (new TextEncoder().encode(mermaid).byteLength > MAX_MERMAID_BYTES) {
    return { ok: false, message: `Mermaid input exceeds ${MAX_MERMAID_BYTES} bytes` };
  }
  const kind = detectKind(mermaid);
  if (kind === undefined) {
    return { ok: false, message: "Supported diagrams are flowchart, sequenceDiagram, classDiagram, and stateDiagram-v2" };
  }
  if (expectedKind !== undefined && kind !== expectedKind) {
    return { ok: false, message: `Diagram kind cannot change from ${expectedKind} to ${kind}` };
  }
  const parsed =
    kind === "flowchart"
      ? parseFlowchart(mermaid)
      : kind === "sequence"
        ? parseSequence(mermaid)
        : kind === "class"
          ? parseClassDiagram(mermaid)
          : parseStateDiagram(mermaid);
  if (parsed.ok) return { ok: true, kind };
  return { ok: false, message: parsed.errors.map((error) => `line ${error.line}: ${error.message}`).join("\n") };
}
