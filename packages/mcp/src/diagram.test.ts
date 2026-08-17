import { describe, expect, it } from "vitest";
import { MAX_MERMAID_BYTES, validateDiagram } from "./diagram";

describe("validateDiagram", () => {
  it.each([
    ["flowchart", "flowchart TB\n  A --> B"],
    ["sequence", "sequenceDiagram\n  A->>B: hello"],
    ["class", "classDiagram\n  class Animal"],
    ["state", "stateDiagram-v2\n  A --> B"],
  ] as const)("accepts a supported %s", (kind, code) => {
    expect(validateDiagram(code)).toEqual({ ok: true, kind });
  });

  it("rejects unsupported and malformed Mermaid", () => {
    expect(validateDiagram("erDiagram\n  A ||--o{ B : has")).toMatchObject({ ok: false });
    expect(validateDiagram("flowchart TB\n  A --")).toMatchObject({ ok: false });
  });

  it("does not allow changing the diagram kind during review", () => {
    expect(validateDiagram("classDiagram\n  class A", "flowchart")).toMatchObject({ ok: false });
  });

  it("rejects oversized UTF-8 input", () => {
    expect(validateDiagram(`flowchart TB\n%%${"あ".repeat(MAX_MERMAID_BYTES)}`)).toMatchObject({ ok: false });
  });
});
