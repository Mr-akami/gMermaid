import { describe, expect, it } from "vitest";
import type { ElementId, RelationId, RequirementId, RequirementIR } from "@gmermaid/ir";
import { requirementToMermaid } from "@gmermaid/mermaid-codegen";
import { parseRequirementDiagram } from "./requirement";

const Q = (s: string) => s as RequirementId;
const E = (s: string) => s as ElementId;
const R = (s: string) => s as RelationId;

describe("parseRequirementDiagram", () => {
  it("parses the docs' sample: requirement/element blocks and a relation", () => {
    const result = parseRequirementDiagram(
      `    requirementDiagram

    requirement test_req {
    id: 1
    text: the test text.
    risk: high
    verifymethod: test
    }

    element test_entity {
    type: simulation
    }

    test_entity - satisfies -> test_req
`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.requirements).toEqual([
      { id: "test_req", name: "test_req", type: "requirement", reqId: "1", text: "the test text.", risk: "High", verifyMethod: "Test" },
    ]);
    expect(result.ir.elements).toEqual([{ id: "test_entity", name: "test_entity", type: "simulation" }]);
    expect(result.ir.relations).toEqual([{ id: "relation-1", from: "test_entity", to: "test_req", type: "satisfies" }]);
  });

  it("parses every requirement type, direction and the mirrored relation form", () => {
    const result = parseRequirementDiagram(
      `requirementDiagram
  direction LR
  functionalRequirement a { }
  interfaceRequirement b { }
  performanceRequirement c { }
  physicalRequirement d { }
  designConstraint e { }
  a <- copies - b
  b - derives -> c
`.replace(/\{ \}/g, "{\n  }"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.direction).toBe("LR");
    expect(result.ir.requirements.map((r) => r.type)).toEqual([
      "functionalRequirement",
      "interfaceRequirement",
      "performanceRequirement",
      "physicalRequirement",
      "designConstraint",
    ]);
    // `a <- copies - b` means b copies a
    expect(result.ir.relations).toEqual([
      { id: "relation-1", from: "b", to: "a", type: "copies" },
      { id: "relation-2", from: "b", to: "c", type: "derives" },
    ]);
  });

  it("folds field-key and enum case, and unquotes values", () => {
    const result = parseRequirementDiagram(
      `requirementDiagram
  requirement r {
    ID: "1.2.1"
    Text: "a: quoted, text"
    Risk: MEDIUM
    VerifyMethod: Demonstration
  }
  element e {
    Type: "word doc"
    DocRef: reqs/test_entity
  }
`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.requirements[0]).toEqual({
      id: "r",
      name: "r",
      type: "requirement",
      reqId: "1.2.1",
      text: "a: quoted, text",
      risk: "Medium",
      verifyMethod: "Demonstration",
    });
    expect(result.ir.elements[0]).toEqual({ id: "e", name: "e", type: "word doc", docRef: "reqs/test_entity" });
  });

  it("accepts quoted names with spaces (mermaid 11.16 does)", () => {
    const result = parseRequirementDiagram(
      `requirementDiagram
  requirement "my req" {
    id: 1
  }
  element "an entity" {
  }
  "an entity" - satisfies -> "my req"
`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.requirements[0]!.name).toBe("my req");
    expect(result.ir.relations[0]).toEqual({ id: "relation-1", from: "an entity", to: "my req", type: "satisfies" });
  });

  it("drops styling statements and `:::` suffixes", () => {
    const result = parseRequirementDiagram(
      `requirementDiagram
  requirement a:::important {
    id: 1
  }
  element e {
  }
  e:::myClass
  classDef important fill:#f96
  class e important
  style a fill:#ffa,stroke:#000
`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.requirements.map((r) => r.name)).toEqual(["a"]);
    expect(result.ir.elements.map((e) => e.name)).toEqual(["e"]);
  });

  it("reports unknown enums, unknown nodes, duplicate names and unclosed blocks", () => {
    const bad = parseRequirementDiagram(
      `requirementDiagram
  requirement a {
    risk: extreme
  }
  element a {
  }
  a - flows -> zzz
`,
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.map((e) => e.message)).toEqual([
      expect.stringContaining("unknown risk"),
      expect.stringContaining("duplicate node name"),
      expect.stringContaining("unknown relation type"),
      expect.stringContaining("unknown node: zzz"),
    ]);

    const unclosed = parseRequirementDiagram(`requirementDiagram\n  requirement a {\n    id: 1\n`);
    expect(unclosed.ok).toBe(false);
    if (unclosed.ok) return;
    expect(unclosed.errors[0]!.message).toContain("unclosed requirement block");
  });

  it("round-trips: parse(gen(ir)) == ir, and gen is stable", () => {
    const ir: RequirementIR = {
      kind: "requirement",
      direction: "LR",
      requirements: [
        {
          id: Q("test_req"),
          name: "test_req",
          type: "functionalRequirement",
          reqId: "1.1",
          text: 'the "second" > text, with #hash',
          risk: "Low",
          verifyMethod: "Inspection",
        },
        { id: Q("my req"), name: "my req", type: "designConstraint" },
      ],
      elements: [
        { id: E("test_entity"), name: "test_entity", type: "word doc", docRef: "reqs/test_entity" },
        { id: E("bare"), name: "bare" },
      ],
      relations: [
        { id: R("relation-1"), from: E("test_entity"), to: Q("test_req"), type: "satisfies" },
        { id: R("relation-2"), from: Q("test_req"), to: Q("my req"), type: "contains" },
        { id: R("relation-3"), from: Q("test_req"), to: Q("test_req"), type: "traces" },
      ],
    };
    const code = requirementToMermaid(ir);
    const back = parseRequirementDiagram(code);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.ir).toEqual(ir);
    expect(requirementToMermaid(back.ir)).toBe(code);
  });

  it("tolerates frontmatter, directives, comments and `;` terminators", () => {
    const result = parseRequirementDiagram(
      `---
title: t
---
%%{init: {"theme":"dark"}}%%
requirementDiagram
%% a comment
  requirement a {
    id: 1
  };
`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.requirements.map((r) => r.name)).toEqual(["a"]);
  });
});
