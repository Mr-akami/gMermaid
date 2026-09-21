import type { Box, Branch, Lifeline, LifelineId, MessageArrowType, SequenceEvent, SequenceIR } from "@gmermaid/ir";
import { isColorToken } from "@gmermaid/ir";

const ARROW_TOKEN: Record<MessageArrowType, string> = {
  solid: "->>",
  dotted: "-->>",
  solidOpen: "->",
  dottedOpen: "-->",
  async: "-)",
  dottedAsync: "--)",
  cross: "-x",
  dottedCross: "--x",
  bidirectional: "<<->>",
  dottedBidirectional: "<<-->>",
};

function escapeText(text: string): string {
  // Sequence labels end at end-of-line; entities as in flowchart labels.
  return text
    .replaceAll("#", "#35;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;")
    .replaceAll(/\r?\n/g, "<br/>")
    // `%%` opens a comment for our line preprocessor (mermaid keeps it here,
    // but the text would not survive our own import), so it travels escaped.
    .replaceAll("%%", "#37;#37;");
}

/** Text form of a branch header: loop bounds are stored structurally and
 * only assembled here — `(min,max) exit` — never inside the IR. */
function branchSpec(b: Branch): string {
  return b.loopBounds !== undefined ? `(${b.loopBounds.min},${b.loopBounds.max}) ${b.condition}`.trim() : b.condition;
}

/** `participant X@{ "type": … } as Alias`. The metadata must come BEFORE
 * `as`: after it, mermaid 11.16 reads it as part of the alias text. */
function declaration(l: Lifeline): string {
  const kw = l.kind === "actor" ? "actor" : "participant";
  const meta = l.kind === "actor" || l.kind === "participant" ? "" : `@{ "type": "${l.kind}" }`;
  // an empty `as` clause is unparseable — fall back to the bare id
  const alias = l.name !== "" && l.name !== l.id ? ` as ${escapeText(l.name)}` : "";
  return `${kw} ${l.id}${meta}${alias}`;
}

/** First word of a box title that reads as a CSS color would be swallowed as
 * the box color on re-import, so an explicit `transparent` guards it. */
function boxHeader(box: Box): string {
  const firstWord = box.name.split(/\s+/)[0] ?? "";
  const color = box.color ?? (firstWord !== "" && isColorToken(firstWord) ? "transparent" : undefined);
  return `box${color !== undefined ? ` ${color}` : ""}${box.name !== "" ? ` ${escapeText(box.name)}` : ""}`;
}

function emitEvents(events: readonly SequenceEvent[], indent: string, lines: string[], lifelines: Map<LifelineId, Lifeline>): void {
  for (const e of events) {
    if (e.kind === "message") {
      const act = e.activate === "start" ? "+" : e.activate === "end" ? "-" : "";
      lines.push(`${indent}${e.from}${ARROW_TOKEN[e.arrow]}${act}${e.to}: ${escapeText(e.label)}`);
      continue;
    }
    if (e.kind === "activation") {
      lines.push(`${indent}${e.on ? "activate" : "deactivate"} ${e.lifeline}`);
      continue;
    }
    if (e.kind === "create") {
      // the create line carries the declaration — mermaid rejects a created
      // participant that was also declared up front
      const l = lifelines.get(e.lifeline);
      lines.push(`${indent}create ${l ? declaration(l) : `participant ${e.lifeline}`}`);
      continue;
    }
    if (e.kind === "destroy") {
      lines.push(`${indent}destroy ${e.lifeline}`);
      continue;
    }
    if (e.kind === "note") {
      const pos = e.position === "leftOf" ? "left of" : e.position === "rightOf" ? "right of" : "over";
      lines.push(`${indent}Note ${pos} ${e.lifelines.join(",")}: ${escapeText(e.text)}`);
      continue;
    }
    const [first, ...rest] = e.branches;
    if (!first) continue;
    // `rect` keeps its fill color in the branch condition, verbatim (a `#rgb`
    // color must not be entity-escaped) and never takes extra branches
    if (e.fragmentKind === "rect") {
      lines.push(`${indent}rect ${first.condition}`.trimEnd());
      emitEvents(first.events, indent + "  ", lines, lifelines);
      lines.push(`${indent}end`);
      continue;
    }
    lines.push(`${indent}${e.fragmentKind} ${escapeText(branchSpec(first))}`.trimEnd());
    emitEvents(first.events, indent + "  ", lines, lifelines);
    for (const branch of rest) {
      const kw = e.fragmentKind === "par" ? "and" : e.fragmentKind === "critical" ? "option" : "else";
      lines.push(`${indent}${kw} ${escapeText(branchSpec(branch))}`.trimEnd());
      emitEvents(branch.events, indent + "  ", lines, lifelines);
    }
    lines.push(`${indent}end`);
  }
}

/** Lifelines a `create` event declares: their header declaration is skipped
 * (including inside a box — mermaid allows no second declaration). */
function createdLifelines(events: readonly SequenceEvent[], out: Set<LifelineId>): Set<LifelineId> {
  for (const e of events) {
    if (e.kind === "create") out.add(e.lifeline);
    else if (e.kind === "fragment") for (const b of e.branches) createdLifelines(b.events, out);
  }
  return out;
}

export function sequenceToMermaid(ir: SequenceIR): string {
  const lines = ["sequenceDiagram"];
  if (ir.autonumber !== undefined) {
    const { start, step } = ir.autonumber;
    lines.push(start === 1 && step === 1 ? "  autonumber" : `  autonumber ${start} ${step}`);
  }
  const byId = new Map(ir.lifelines.map((l) => [l.id, l]));
  const created = createdLifelines(ir.events, new Set());
  const boxOf = new Map<LifelineId, Box>();
  for (const b of ir.boxes) for (const id of b.lifelines) boxOf.set(id, b);

  const emittedBox = new Set<string>();
  for (const l of ir.lifelines) {
    const box = boxOf.get(l.id);
    if (box === undefined) {
      if (!created.has(l.id)) lines.push(`  ${declaration(l)}`);
      continue;
    }
    if (emittedBox.has(box.id)) continue;
    emittedBox.add(box.id);
    // box members are declared together, in lifeline order, inside the block
    const members = ir.lifelines.filter((m) => boxOf.get(m.id) === box && !created.has(m.id));
    if (members.length === 0) continue;
    lines.push(`  ${boxHeader(box)}`);
    for (const m of members) lines.push(`    ${declaration(m)}`);
    lines.push("  end");
  }
  emitEvents(ir.events, "  ", lines, byId);
  return lines.join("\n") + "\n";
}
