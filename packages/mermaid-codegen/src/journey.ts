import { sanitizeJourneyText, type JourneyIR } from "@gmermaid/ir";

// Journey text has no escaping: `:` `#` `;` are structural everywhere, so
// names are sanitized (the reducer already did this for GUI input; parser
// output can never contain them).
const clean = (text: string) => sanitizeJourneyText(text);

export function journeyToMermaid(ir: JourneyIR): string {
  const lines = ["journey"];
  if (ir.title !== undefined && clean(ir.title) !== "") lines.push(`  title ${clean(ir.title)}`);
  ir.sections.forEach((s, i) => {
    const name = clean(s.name);
    // the unnamed section is implicit only when it comes first
    if (name !== "" || i > 0) lines.push(`  section ${name === "" ? "Untitled" : name}`);
    for (const t of s.tasks) {
      const actors = t.actors.map((a) => sanitizeJourneyText(a, { actor: true })).filter((a) => a !== "");
      const taskName = clean(t.name) === "" ? "Task" : clean(t.name);
      lines.push(`    ${taskName}: ${t.score}${actors.length > 0 ? `: ${actors.join(", ")}` : ""}`);
    }
  });
  return lines.join("\n") + "\n";
}
