import { describe, expect, it } from "vitest";
import type { ElementId, RelationId, RequirementId } from "./ids";
import type { RequirementIR } from "./requirement";
import { applyRequirementAction, requirementRelationRetargetRejection } from "./requirementActions";

const Q = (s: string) => s as RequirementId;
const E = (s: string) => s as ElementId;
const R = (s: string) => s as RelationId;

const base: RequirementIR = {
  kind: "requirement",
  requirements: [{ id: Q("test_req"), name: "test_req", type: "requirement", reqId: "1", risk: "High" }],
  elements: [{ id: E("test_entity"), name: "test_entity", type: "simulation" }],
  relations: [],
};

describe("applyRequirementAction", () => {
  it("rejects names that collide across requirements and elements", () => {
    const dup = applyRequirementAction(base, {
      type: "addElement",
      element: { id: E("x"), name: "test_req" },
    });
    expect(dup).toBe(base);
    const renamed = applyRequirementAction(base, { type: "renameNode", id: Q("test_req"), name: "test_entity" });
    expect(renamed).toBe(base);
  });

  it("rejects names a quoted mermaid name cannot carry", () => {
    for (const name of ['a"b', "a\nb", "a{b", ""]) {
      expect(applyRequirementAction(base, { type: "addRequirement", requirement: { id: Q("n"), name, type: "requirement" } })).toBe(base);
    }
    // spaces and keywords are fine: codegen quotes them
    const ok = applyRequirementAction(base, { type: "addRequirement", requirement: { id: Q("n"), name: "my req", type: "requirement" } });
    expect(ok.requirements).toHaveLength(2);
  });

  it("drops empty optional fields instead of storing them", () => {
    const next = applyRequirementAction(base, {
      type: "updateRequirement",
      id: Q("test_req"),
      text: "",
      risk: "",
      verifyMethod: "Test",
    });
    expect(next.requirements[0]).toEqual({ id: "test_req", name: "test_req", type: "requirement", reqId: "1", verifyMethod: "Test" });
    expect(applyRequirementAction(next, { type: "updateRequirement", id: Q("test_req"), verifyMethod: "Test" })).toBe(next);
  });

  it("connects requirements and elements in either direction, including self-relations", () => {
    let ir = applyRequirementAction(base, {
      type: "addRelation",
      relation: { id: R("r1"), from: E("test_entity"), to: Q("test_req"), type: "satisfies" },
    });
    ir = applyRequirementAction(ir, {
      type: "addRelation",
      relation: { id: R("r2"), from: Q("test_req"), to: Q("test_req"), type: "traces" },
    });
    expect(ir.relations.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(applyRequirementAction(ir, { type: "addRelation", relation: { id: R("r3"), from: Q("nope"), to: Q("test_req"), type: "traces" } })).toBe(ir);
    const removed = applyRequirementAction(ir, { type: "removeNode", id: E("test_entity") });
    expect(removed.elements).toEqual([]);
    expect(removed.relations.map((r) => r.id)).toEqual(["r2"]);
  });
});

// Re-pointing a relation used to mean deleting it and drawing a new one,
// which threw away its type.
describe("retargetRelation", () => {
  const second = applyRequirementAction(base, {
    type: "addRequirement",
    requirement: { id: Q("other_req"), name: "other_req", type: "designConstraint" },
  });
  const rich = applyRequirementAction(second, {
    type: "addRelation",
    relation: { id: R("r1"), from: Q("test_req"), to: E("test_entity"), type: "satisfies" },
  });

  it("moves one end and keeps the relation type", () => {
    const next = applyRequirementAction(rich, { type: "retargetRelation", id: R("r1"), to: Q("other_req") });
    expect(next.relations[0]).toEqual({ id: "r1", from: "test_req", to: "other_req", type: "satisfies" });
  });

  it("swaps both ends in one action, and either end may be a requirement or an element", () => {
    const next = applyRequirementAction(rich, { type: "retargetRelation", id: R("r1"), from: E("test_entity"), to: Q("test_req") });
    expect(next.relations[0]).toMatchObject({ from: "test_entity", to: "test_req", type: "satisfies" });
  });

  it("allows a self-relation", () => {
    const next = applyRequirementAction(rich, { type: "retargetRelation", id: R("r1"), to: Q("test_req") });
    expect(next.relations[0]).toMatchObject({ from: "test_req", to: "test_req" });
  });

  it("refuses an unknown end, an unknown relation and a no-op — same reference", () => {
    expect(applyRequirementAction(rich, { type: "retargetRelation", id: R("r1"), to: Q("zzz") })).toBe(rich);
    expect(applyRequirementAction(rich, { type: "retargetRelation", id: R("r1"), from: Q("zzz") })).toBe(rich);
    expect(applyRequirementAction(rich, { type: "retargetRelation", id: R("ghost"), to: Q("other_req") })).toBe(rich);
    expect(applyRequirementAction(rich, { type: "retargetRelation", id: R("r1"), from: Q("test_req"), to: E("test_entity") })).toBe(rich);
  });

  it("names each refusal, and none for a legal move", () => {
    expect(requirementRelationRetargetRejection(rich, R("r1"), { from: Q("zzz") })).toBe("unknown source");
    expect(requirementRelationRetargetRejection(rich, R("r1"), { to: Q("zzz") })).toBe("unknown target");
    expect(requirementRelationRetargetRejection(rich, R("ghost"), { to: Q("test_req") })).toBe("unknown relation");
    expect(requirementRelationRetargetRejection(rich, R("r1"), { to: Q("test_req") })).toBeUndefined();
  });
});
