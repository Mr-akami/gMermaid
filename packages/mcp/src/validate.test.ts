import { describe, expect, it } from "vitest";
import { extractBlocks, formatReports, hasErrors, validateBlock, withMermaidJs } from "./validate";

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
    const { lines, failed } = check("a.mmd", "flowchart TB\n  A --> B\n  click A cb \"tip\"\n");
    expect(failed).toBe(false);
    expect(lines[0]).toMatch(/^a\.mmd:3: warning: /);
    expect(lines[1]).toBe("a.mmd:1: ok (flowchart)");
  });

  it("says so when a Markdown file holds no diagram", () => {
    expect(check("doc.md", "# nothing\n").lines).toEqual(["doc.md: warning: no mermaid diagram found"]);
  });
});

describe("validate with Mermaid.js", () => {
  const block = { text: "flowchart TB\n  A --> B\n", startLine: 1 };

  it("reports what Mermaid.js rejects in the text as written, at its line", async () => {
    const report = await withMermaidJs(block, validateBlock(block), async () => ({ line: 2, message: "nope" }));
    expect(formatReports("a.mmd", [report])).toEqual(["a.mmd:2: error: Mermaid.js rejects this: nope"]);
  });

  it("reports when only the editor's rewrite is rejected — the editor would block Send", async () => {
    const judge = async (text: string) => (text === block.text ? undefined : { message: "rewrite broke" });
    const report = await withMermaidJs(block, validateBlock(block), judge);
    expect(hasErrors([report])).toBe(true);
    expect(formatReports("a.mmd", [report])[0]).toMatch(/editor's rewrite .* rejected by Mermaid\.js.*rewrite broke/);
  });

  it("warns, and still passes, when Mermaid.js cannot run", async () => {
    const report = await withMermaidJs(block, validateBlock(block), async () => {
      throw new Error("no DOM");
    });
    expect(formatReports("a.mmd", [report])).toEqual(["a.mmd:1: warning: Mermaid.js check skipped: no DOM", "a.mmd:1: ok (flowchart)"]);
  });

  it("the real Mermaid.js catches a text gMermaid's own parser accepts", async () => {
    const { mermaidRejects } = await import("./mermaidCheck");
    const bad = { text: "stateDiagram-v2\n  state idle\n  state constructing {\n    state x\n  }\n", startLine: 1 };
    const first = validateBlock(bad);
    expect(hasErrors([first])).toBe(false);
    const report = await withMermaidJs(bad, first, mermaidRejects);
    expect(formatReports("a.mmd", [report])[0]).toMatch(/^a\.mmd:1: error: Mermaid\.js rejects this: .*single word/);
  }, 30_000);
});
