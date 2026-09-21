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
