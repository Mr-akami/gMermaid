import { describe, expect, it } from "vitest";
import { extractBlocks, formatReports, hasErrors, validateBlock } from "./validate";

function check(source: string, text: string) {
  const reports = extractBlocks(source, text).map(validateBlock);
  return { lines: formatReports(source, reports), failed: hasErrors(reports) };
}

describe("validate", () => {
  it("passes a valid .mmd file", () => {
    expect(check("a.mmd", "flowchart TB\n  A --> B\n")).toEqual({ lines: ["a.mmd:1: ok (flowchart)"], failed: false });
  });

  it("names the line of a parse error", () => {
    const { lines, failed } = check("a.mmd", "sequenceDiagram\n  A->>B: hi\n  this is not a statement\n");
    expect(failed).toBe(true);
    expect(lines[0]).toMatch(/^a\.mmd:3: error: /);
  });

  it("refuses an unknown kind", () => {
    const { lines, failed } = check("-", "pie\n  \"a\": 1\n");
    expect(failed).toBe(true);
    expect(lines[0]).toMatch(/^-:1: error: unknown diagram kind/);
  });

  it("checks every mermaid fence of a Markdown file at its own line", () => {
    const md = ["# Design", "", "```mermaid", "flowchart LR", "  A --> B", "```", "", "~~~mermaid", "classDiagram", "  class A", "  bogus line here !!", "~~~", ""].join("\n");
    const { lines, failed } = check("doc.md", md);
    expect(failed).toBe(true);
    expect(lines[0]).toBe("doc.md:4: ok (flowchart)");
    expect(lines[1]).toMatch(/^doc\.md:11: error: /);
  });

  it("reports statements the editor would drop as warnings, not errors", () => {
    const { lines, failed } = check("a.mmd", "flowchart TB\n  A --> B\n  classDef hot fill:#f00\n");
    expect(failed).toBe(false);
    expect(lines[0]).toMatch(/^a\.mmd:3: warning: /);
    expect(lines[1]).toBe("a.mmd:1: ok (flowchart)");
  });

  it("says so when a Markdown file holds no diagram", () => {
    expect(check("doc.md", "# nothing\n").lines).toEqual(["doc.md: warning: no mermaid diagram found"]);
  });
});
