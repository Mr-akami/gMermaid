import { describe, expect, it } from "vitest";
import { drawMachine } from "./fromXState";

describe("from-xstate", () => {
  const one = `export const m = setup({}).createMachine({ initial: "a", states: { a: { on: { GO: () => ({ target: "b" }) } }, b: { type: "final" } } });`;

  it("prints a stateDiagram for the one machine in a file", () => {
    const r = drawMachine("m.ts", one);
    expect(r.ok && r.mermaid).toContain("a --> b : GO");
    expect(r.ok && r.notes.join("\n")).toMatch(/^m\.ts:1: note: read-only picture/);
  });

  it("asks which machine when a file has several, and finds it by name", () => {
    const two = `const a = createMachine({ initial: "x", states: { x: {} } });\nconst b = createMachine({ initial: "y", states: { y: {} } });`;
    const r = drawMachine("two.ts", two);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/2 machines \(a, b\) — pick one with --machine NAME/);
    expect(drawMachine("two.ts", two, "b").ok).toBe(true);
    expect(!drawMachine("two.ts", two, "c").ok).toBe(true);
  });

  it("reports source it cannot read, with the line", () => {
    const r = drawMachine("bad.ts", "createMachine({ states: {");
    expect(!r.ok && r.message).toMatch(/^bad\.ts:\d+: error: /);
  });
});
