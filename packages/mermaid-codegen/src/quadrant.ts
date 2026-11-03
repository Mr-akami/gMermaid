import { clampUnit, sanitizeQuadrantText, type QuadrantAxis, type QuadrantIR } from "@gmermaid/ir";

// Canonical form: every piece of text quoted. Unquoted, mermaid's lexer reads
// `quadrant-1 a: b` as a parse error and `A: b` as a point that never closes;
// quoted, everything but `"` itself is literal (`"` becomes `'`, as in the IR
// sanitizer — mermaid has no escape).

const quote = (text: string): string => `"${sanitizeQuadrantText(text)}"`;

/** `0`, `1` or `0.xxxx` — the only shapes mermaid's lexer reads (`1.0` and
 * `.5` are lexical errors), with no exponent. */
function unit(v: number): string {
  return String(clampUnit(v));
}

function axisLine(name: "x-axis" | "y-axis", axis: QuadrantAxis): string | undefined {
  const low = sanitizeQuadrantText(axis.low);
  const high = sanitizeQuadrantText(axis.high);
  if (low === "" && high === "") return undefined;
  if (high === "") return `${name} ${quote(low)}`;
  // `x-axis --> High` and `x-axis "" --> "High"` are parse errors; one
  // space inside the quotes is the smallest left end mermaid accepts, and
  // the parser trims it back to nothing
  return `${name} ${low === "" ? '" "' : quote(low)} --> ${quote(high)}`;
}

export function quadrantToMermaid(ir: QuadrantIR): string {
  const lines = ["quadrantChart"];
  const title = sanitizeQuadrantText(ir.title ?? "");
  if (title !== "") lines.push(`  title ${quote(title)}`);
  const x = axisLine("x-axis", ir.xAxis);
  if (x !== undefined) lines.push(`  ${x}`);
  const y = axisLine("y-axis", ir.yAxis);
  if (y !== undefined) lines.push(`  ${y}`);
  ir.quadrants.forEach((label, i) => {
    if (sanitizeQuadrantText(label) !== "") lines.push(`  quadrant-${i + 1} ${quote(label)}`);
  });
  for (const p of ir.points) {
    const name = sanitizeQuadrantText(p.label);
    if (name === "") continue; // a nameless point has no mermaid form
    lines.push(`  ${quote(name)}: [${unit(p.x)}, ${unit(p.y)}]`);
  }
  return lines.join("\n") + "\n";
}
