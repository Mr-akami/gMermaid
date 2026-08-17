import type { MessageArrowType, SequenceEvent, SequenceIR } from "@gmermaid/ir";

const ARROW_TOKEN: Record<MessageArrowType, string> = {
  solid: "->>",
  dotted: "-->>",
  solidOpen: "->",
  dottedOpen: "-->",
  async: "-)",
};

function escapeText(text: string): string {
  // Sequence labels end at end-of-line; entities as in flowchart labels.
  return text
    .replaceAll("#", "#35;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;")
    .replaceAll(/\r?\n/g, "<br/>");
}

function emitEvents(events: readonly SequenceEvent[], indent: string, lines: string[]): void {
  for (const e of events) {
    if (e.kind === "message") {
      lines.push(`${indent}${e.from}${ARROW_TOKEN[e.arrow]}${e.to}: ${escapeText(e.label)}`);
      continue;
    }
    if (e.kind === "note") {
      const pos = e.position === "leftOf" ? "left of" : e.position === "rightOf" ? "right of" : "over";
      lines.push(`${indent}Note ${pos} ${e.lifelines.join(",")}: ${escapeText(e.text)}`);
      continue;
    }
    const [first, ...rest] = e.branches;
    if (!first) continue;
    lines.push(`${indent}${e.fragmentKind} ${escapeText(first.condition)}`.trimEnd());
    emitEvents(first.events, indent + "  ", lines);
    for (const branch of rest) {
      const kw = e.fragmentKind === "par" ? "and" : "else";
      lines.push(`${indent}${kw} ${escapeText(branch.condition)}`.trimEnd());
      emitEvents(branch.events, indent + "  ", lines);
    }
    lines.push(`${indent}end`);
  }
}

export function sequenceToMermaid(ir: SequenceIR): string {
  const lines = ["sequenceDiagram"];
  for (const l of ir.lifelines) {
    const kw = l.isActor ? "actor" : "participant";
    // an empty `as` clause is unparseable — fall back to the bare id
    const alias = l.name !== "" && l.name !== l.id ? ` as ${escapeText(l.name)}` : "";
    lines.push(`  ${kw} ${l.id}${alias}`);
  }
  emitEvents(ir.events, "  ", lines);
  return lines.join("\n") + "\n";
}
