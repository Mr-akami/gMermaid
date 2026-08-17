import { describe, expect, it } from "vitest";
import type { ClassId, RelationId } from "./ids";
import type { ClassIR } from "./classdiagram";
import { applyClassAction } from "./classActions";

const C = (s: string) => s as ClassId;
const R = (s: string) => s as RelationId;

const base: ClassIR = {
  kind: "class",
  classes: [
    { id: C("TreeNode"), name: "TreeNode", attributes: [{ name: "value", visibility: "public" }], methods: [] },
    { id: C("Other"), name: "Other", attributes: [], methods: [] },
  ],
  relations: [],
};

describe("applyClassAction", () => {
  it("allows self-relations (TreeNode → TreeNode)", () => {
    const next = applyClassAction(base, {
      type: "addRelation",
      relation: { id: R("r1"), from: C("TreeNode"), to: C("TreeNode"), type: "association", label: "children" },
    });
    expect(next.relations).toEqual([
      { id: "r1", from: "TreeNode", to: "TreeNode", type: "association", label: "children" },
    ]);
  });

  it("setMembers rejects member names that break the round trip", () => {
    for (const name of ["a b", "a:b", "a(b", "a\nb", ""]) {
      const next = applyClassAction(base, {
        type: "setMembers",
        id: C("TreeNode"),
        attributes: [{ name, visibility: "public" }],
        methods: [],
      });
      expect(next).toBe(base); // rejected: same reference
    }
  });

  it("setMembers rejects params containing a closing paren or newline", () => {
    const next = applyClassAction(base, {
      type: "setMembers",
      id: C("TreeNode"),
      attributes: [],
      methods: [{ name: "run", visibility: "public", params: "x), y" }],
    });
    expect(next).toBe(base);
  });

  it("setMembers preserves identity when the members are unchanged", () => {
    const next = applyClassAction(base, {
      type: "setMembers",
      id: C("TreeNode"),
      attributes: [{ name: "value", visibility: "public" }],
      methods: [],
    });
    expect(next).toBe(base);
  });

  it("omits cleared optional fields instead of storing undefined", () => {
    const withStereotype = applyClassAction(base, { type: "setStereotype", id: C("TreeNode"), stereotype: "entity" });
    expect(withStereotype.classes[0]).toHaveProperty("stereotype", "entity");
    const cleared = applyClassAction(withStereotype, { type: "setStereotype", id: C("TreeNode"), stereotype: "" });
    expect("stereotype" in cleared.classes[0]!).toBe(false);

    const withRel = applyClassAction(base, {
      type: "addRelation",
      relation: { id: R("r1"), from: C("TreeNode"), to: C("Other"), type: "association", label: "x" },
    });
    const relCleared = applyClassAction(withRel, { type: "updateRelation", id: R("r1"), label: "" });
    expect("label" in relCleared.relations[0]!).toBe(false);
  });
});
