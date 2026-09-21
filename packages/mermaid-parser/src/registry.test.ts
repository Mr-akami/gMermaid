import { describe, expect, it } from "vitest";
import { detectDiagramKind } from "./registry";

describe("detectDiagramKind", () => {
  it("reads the header keyword", () => {
    expect(detectDiagramKind("flowchart LR\nA-->B")).toBe("flowchart");
    expect(detectDiagramKind("  graph TD\nA-->B")).toBe("flowchart");
    expect(detectDiagramKind("sequenceDiagram\nA->>B: x")).toBe("sequence");
    expect(detectDiagramKind("classDiagram\nclass A")).toBe("class");
    expect(detectDiagramKind("stateDiagram-v2\n[*] --> A")).toBe("state");
    expect(detectDiagramKind("journey\n  title x")).toBe("journey");
    expect(detectDiagramKind("requirementDiagram\nrequirement a {\n}")).toBe("requirement");
    expect(detectDiagramKind("timeline\n  2002 : LinkedIn")).toBe("timeline");
    expect(detectDiagramKind("pie\n")).toBeUndefined();
  });
  it("skips frontmatter, comments and init directives", () => {
    expect(detectDiagramKind("---\ntitle: t\n---\n%%{init: {}}%%\n%% c\nstateDiagram-v2\n")).toBe("state");
  });
});
