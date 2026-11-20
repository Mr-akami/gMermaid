import { DIAGRAM_KINDS, detectDiagramKind, parseDiagram, type DiagramKind } from "@gmermaid/mermaid-parser";
import { canonicalMermaid } from "./diagram";
import type { MermaidRejection } from "./mermaidCheck";

// `gmermaid validate`: the parser the editor opens files with, run where an
// agent can call it after writing a diagram. A diagram that passes here opens
// in the GUI; one that does not would open as a broken draft instead.

export interface MermaidBlock {
  readonly text: string;
  /** 1-based line of the block's first line in the source file. */
  readonly startLine: number;
}

export interface Finding {
  readonly line: number;
  readonly severity: "error" | "warning";
  readonly message: string;
}

export interface BlockReport {
  readonly startLine: number;
  readonly kind?: DiagramKind | undefined;
  readonly findings: readonly Finding[];
}

const FENCE_OPEN = /^\s*(`{3,}|~{3,})\s*mermaid\b/;

function isMarkdown(source: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(source);
}

/** The diagrams in a file: every ```mermaid fence of a Markdown file, or the
 * whole of anything else (.mmd, stdin). */
export function extractBlocks(source: string, text: string): MermaidBlock[] {
  if (!isMarkdown(source)) return [{ text, startLine: 1 }];
  const lines = text.split(/\r?\n/);
  const blocks: MermaidBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i]!);
    if (open === null) continue;
    const fence = open[1]!;
    const body: string[] = [];
    let j = i + 1;
    // a closing fence is the same character, at least as long
    while (j < lines.length && !new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`).test(lines[j]!)) {
      body.push(lines[j]!);
      j++;
    }
    blocks.push({ text: `${body.join("\n")}\n`, startLine: i + 2 });
    i = j;
  }
  return blocks;
}

export function validateBlock(block: MermaidBlock): BlockReport {
  const at = (line: number) => block.startLine + line - 1;
  const kind = detectDiagramKind(block.text);
  if (kind === undefined) {
    return {
      startLine: block.startLine,
      findings: [{ line: block.startLine, severity: "error", message: `unknown diagram kind (supported: ${DIAGRAM_KINDS.join(", ")})` }],
    };
  }
  const parsed = parseDiagram(kind, block.text);
  const findings: Finding[] = parsed.ok
    ? parsed.warnings.map((w) => ({ line: at(w.line), severity: "warning" as const, message: w.message }))
    : parsed.errors.map((e) => ({ line: at(e.line), severity: "error" as const, message: e.message }));
  return { startLine: block.startLine, kind, findings };
}

/** mermaid.js's verdict on one text; the seam tests replace. */
export type MermaidJudge = (text: string) => Promise<MermaidRejection | undefined>;

/** Add mermaid.js's verdicts to a report gMermaid's parser already passed:
 * on the text as written, and on the text the editor writes back for it
 * (which is what the editor checks once the diagram is opened). A judge that
 * cannot run at all leaves a warning, never a pass dressed up as checked. */
export async function withMermaidJs(block: MermaidBlock, report: BlockReport, judge: MermaidJudge): Promise<BlockReport> {
  if (report.kind === undefined || report.findings.some((f) => f.severity === "error")) return report;
  const findings = [...report.findings];
  try {
    const asWritten = await judge(block.text);
    if (asWritten !== undefined) {
      findings.push({ line: block.startLine + (asWritten.line ?? 1) - 1, severity: "error", message: `Mermaid.js rejects this: ${asWritten.message}` });
    } else {
      const rewrite = canonicalMermaid(block.text);
      const rejected = rewrite === undefined || rewrite === block.text ? undefined : await judge(rewrite);
      if (rejected !== undefined) {
        findings.push({
          line: block.startLine,
          severity: "error",
          message: `the editor's rewrite of this diagram is rejected by Mermaid.js, so the editor would block sending it back (a gMermaid bug — please report it): ${rejected.message}`,
        });
      }
    }
  } catch (cause) {
    findings.push({ line: block.startLine, severity: "warning", message: `Mermaid.js check skipped: ${cause instanceof Error ? cause.message : String(cause)}` });
  }
  return { ...report, findings };
}

/** One line per finding, compiler style (`file:line: severity: message`), and
 * one `ok` line per clean diagram so a pass is visible too. */
export function formatReports(source: string, reports: readonly BlockReport[]): string[] {
  if (reports.length === 0) return [`${source}: warning: no mermaid diagram found`];
  const out: string[] = [];
  for (const r of reports) {
    for (const f of r.findings) out.push(`${source}:${f.line}: ${f.severity}: ${f.message}`);
    if (!r.findings.some((f) => f.severity === "error")) out.push(`${source}:${r.startLine}: ok (${r.kind})`);
  }
  return out;
}

export function hasErrors(reports: readonly BlockReport[]): boolean {
  return reports.some((r) => r.findings.some((f) => f.severity === "error"));
}
