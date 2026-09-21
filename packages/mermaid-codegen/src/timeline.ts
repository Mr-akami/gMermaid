import type { TimelineIR } from "@gmermaid/ir";

// Canonical form: one line per period, `label : e1 : e2`. Mermaid also allows
// continuation lines starting with `:`; the parser reads both, codegen emits
// only the one-line form so a round trip is stable.

/** Timeline text is raw in mermaid (`#`, `<`, `>` are literal there), so the
 * only transform is the line break. `:` never reaches here — the reducer and
 * the parser both refuse it. */
const escapeText = (text: string): string => text.replaceAll(/\r?\n/g, "<br>");

export function timelineToMermaid(ir: TimelineIR): string {
  const lines = ["timeline"];
  if (ir.title !== undefined) lines.push(`  title ${escapeText(ir.title)}`);

  for (const section of ir.sections) {
    const indent = section.name === "" ? "  " : "    ";
    if (section.name !== "") lines.push(`  section ${escapeText(section.name)}`);
    for (const period of section.periods) {
      const events = period.events.map((e) => ` : ${escapeText(e.text)}`).join("");
      lines.push(`${indent}${escapeText(period.label)}${events}`);
    }
  }

  return lines.join("\n") + "\n";
}
