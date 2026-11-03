import { describe, expect, it } from "vitest";
import { MAX_MERMAID_BYTES, validateDiagram } from "./diagram";

describe("validateDiagram", () => {
  it.each([
    ["flowchart", "flowchart TB\n  A --> B"],
    ["sequence", "sequenceDiagram\n  A->>B: hello"],
    ["class", "classDiagram\n  class Animal"],
    ["state", "stateDiagram-v2\n  A --> B"],
    ["requirement", "requirementDiagram\n  requirement a {\n  }"],
    ["er", "erDiagram\n  A ||--o{ B : has"],
    ["timeline", "timeline\n  2002 : LinkedIn"],
    ["quadrant", "quadrantChart\n  \"A\": [0.3, 0.6]"],
    ["gantt", "gantt\n  section S\n  A task :a1, 2014-01-01, 30d"],
  ] as const)("accepts a supported %s", (kind, code) => {
    expect(validateDiagram(code)).toEqual({ ok: true, kind });
  });

  it("rejects unsupported and malformed Mermaid", () => {
    expect(validateDiagram('pie\n  "a" : 1')).toMatchObject({ ok: false });
    expect(validateDiagram("flowchart TB\n  A --")).toMatchObject({ ok: false });
  });

  it("does not allow changing the diagram kind during review", () => {
    expect(validateDiagram("classDiagram\n  class A", "flowchart")).toMatchObject({ ok: false });
  });

  it("rejects oversized UTF-8 input", () => {
    expect(validateDiagram(`flowchart TB\n%%${"あ".repeat(MAX_MERMAID_BYTES)}`)).toMatchObject({ ok: false });
  });
});
