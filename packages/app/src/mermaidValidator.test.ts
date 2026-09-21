// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createMermaidValidator, type MermaidVerdict, validateWithMermaid } from "./mermaidValidator";

// mermaid touches the DOM on init, hence jsdom.

function collect(options: Parameters<typeof createMermaidValidator>[1] = {}) {
  const verdicts: MermaidVerdict[] = [];
  const validator = createMermaidValidator((v) => verdicts.push(v), options);
  return { verdicts, validator, last: () => verdicts[verdicts.length - 1] };
}

/** Wait until `predicate` holds (the validator settles on its own timers). */
async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out waiting for a verdict");
}

describe("validateWithMermaid", () => {
  it("accepts text the real mermaid parser understands", async () => {
    await expect(validateWithMermaid('flowchart TB\n  a["A"] --> b["B"]\n')).resolves.toBeUndefined();
  });

  it("rejects text mermaid cannot parse, with a one-line message", async () => {
    // the user's bug: `subgraph` is a mermaid keyword, so an id starting with
    // it cannot appear as an edge endpoint — our own parser reads it happily
    const message = await validateWithMermaid('flowchart TB\n  a["A"]\n  subgraph subgraph-1["G"]\n  end\n  a --> subgraph-1\n');
    expect(message).toBeDefined();
    expect(message).not.toContain("\n");
    expect(message).toMatch(/Parse error/i);
  });

  it("rejects text that is not a diagram at all", async () => {
    await expect(validateWithMermaid("definitely not mermaid")).resolves.toBeDefined();
  });
});

describe("createMermaidValidator", () => {
  it("reports ok for accepted text", async () => {
    const { validator, last } = collect({ debounceMs: 1, validate: async () => undefined });
    validator.check("flowchart TB");
    await until(() => last()?.status === "ok");
    validator.dispose();
  });

  it("reports the message for rejected text", async () => {
    const { validator, last } = collect({ debounceMs: 1, validate: async () => "boom" });
    validator.check("flowchart TB");
    await until(() => last()?.status === "rejected");
    expect(last()).toEqual({ status: "rejected", message: "boom" });
    validator.dispose();
  });

  it("lets the newest text win when runs overlap", async () => {
    // "old" resolves late and rejects; "new" resolves early and is fine
    const validate = vi.fn(async (text: string) => {
      await new Promise((r) => setTimeout(r, text === "old" ? 60 : 1));
      return text === "old" ? "stale error" : undefined;
    });
    const { validator, verdicts, last } = collect({ debounceMs: 1, validate });
    validator.check("old");
    await new Promise((r) => setTimeout(r, 5)); // let the "old" run start
    validator.check("new");
    await until(() => last()?.status === "ok");
    await new Promise((r) => setTimeout(r, 120)); // "old" lands here — and must lose
    expect(last()).toEqual({ status: "ok" });
    expect(verdicts.filter((v) => v.status === "rejected")).toHaveLength(0);
    validator.dispose();
  });

  it("clears a previous verdict as soon as the text changes", async () => {
    const { validator, verdicts, last } = collect({ debounceMs: 1, validate: async () => "boom" });
    validator.check("a");
    await until(() => last()?.status === "rejected");
    validator.check("b");
    expect(verdicts[verdicts.length - 1]).toEqual({ status: "pending" });
    validator.dispose();
  });

  it("degrades to 'unavailable' — never to ok — when the validator itself fails", async () => {
    const { validator, last } = collect({
      debounceMs: 1,
      validate: () => Promise.reject(new Error("failed to fetch dynamically imported module")),
    });
    validator.check("flowchart TB");
    await until(() => last()?.status === "unavailable");
    validator.dispose();
  });

  it("stays quiet after dispose", async () => {
    const { validator, verdicts } = collect({ debounceMs: 5, validate: async () => "boom" });
    validator.check("flowchart TB");
    validator.dispose();
    await new Promise((r) => setTimeout(r, 40));
    expect(verdicts.some((v) => v.status === "rejected")).toBe(false);
  });
});

describe("the dynamic import failing", () => {
  it("surfaces as a rejected promise, so callers fall back to 'unavailable'", async () => {
    vi.resetModules();
    vi.doMock("mermaid", () => {
      throw new Error("failed to fetch dynamically imported module");
    });
    const mod = await import("./mermaidValidator");
    await expect(mod.validateWithMermaid("flowchart TB")).rejects.toThrow(/could not be loaded/);

    const verdicts: MermaidVerdict[] = [];
    const validator = mod.createMermaidValidator((v) => verdicts.push(v), { debounceMs: 1 });
    validator.check("flowchart TB");
    await until(() => verdicts[verdicts.length - 1]?.status === "unavailable");
    validator.dispose();
    vi.doUnmock("mermaid");
    vi.resetModules();
  });
});
