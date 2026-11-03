import { describe, expect, it } from "vitest";
import type { ErAttribute, ErEntity, ErIR } from "./er";
import { applyErAction, erRetargetRejection } from "./erActions";
import type { AttributeId, EntityId, RelationId } from "./ids";

const E = (s: string) => s as EntityId;
const A = (s: string) => s as AttributeId;
const R = (s: string) => s as RelationId;
const attr = (id: string, name: string, type = "int"): ErAttribute => ({ id: A(id), type, name, keys: [] });

const base: ErIR = {
  kind: "er",
  entities: [
    { id: E("c"), name: "CUSTOMER", attributes: [attr("a1", "id"), attr("a2", "email", "string")] },
    { id: E("o"), name: "ORDER", attributes: [] },
  ],
  relationships: [],
};
const entity = (ir: ErIR, id: string): ErEntity => ir.entities.find((e) => e.id === id)!;

describe("applyErAction: entities", () => {
  it("rejects duplicate ids and names, and names a quoted name cannot carry", () => {
    expect(applyErAction(base, { type: "addEntity", entity: { id: E("x"), name: "ORDER", attributes: [] } })).toBe(base);
    expect(applyErAction(base, { type: "addEntity", entity: { id: E("c"), name: "NEW", attributes: [] } })).toBe(base);
    for (const name of ['a"b', "a\nb", ""]) {
      expect(applyErAction(base, { type: "addEntity", entity: { id: E("x"), name, attributes: [] } })).toBe(base);
    }
    // spaces and keywords are fine: codegen quotes them
    expect(applyErAction(base, { type: "addEntity", entity: { id: E("x"), name: "line item", attributes: [] } }).entities).toHaveLength(3);
    expect(applyErAction(base, { type: "renameEntity", id: E("c"), name: "ORDER" })).toBe(base);
    expect(entity(applyErAction(base, { type: "renameEntity", id: E("c"), name: "CLIENT" }), "c").name).toBe("CLIENT");
  });

  it("removes an entity together with its relationships", () => {
    const wired = applyErAction(base, {
      type: "addRelationship",
      relationship: { id: R("r"), from: E("c"), to: E("o"), fromCard: "exactly-one", toCard: "zero-or-more", identifying: true },
    });
    const gone = applyErAction(wired, { type: "removeEntity", id: E("o") });
    expect(gone.entities.map((e) => e.id)).toEqual(["c"]);
    expect(gone.relationships).toEqual([]);
  });

  it("stores an empty alias as unset", () => {
    const aliased = applyErAction(base, { type: "setAlias", id: E("c"), alias: "Client" });
    expect(entity(aliased, "c").alias).toBe("Client");
    const cleared = applyErAction(aliased, { type: "setAlias", id: E("c"), alias: "" });
    expect("alias" in entity(cleared, "c")).toBe(false);
    expect(applyErAction(cleared, { type: "setAlias", id: E("c"), alias: "" })).toBe(cleared);
  });
});

describe("applyErAction: attributes", () => {
  it("adds, updates, reorders and removes", () => {
    let ir = applyErAction(base, { type: "addAttribute", entityId: E("o"), attribute: { ...attr("a3", "total", "decimal(10,2)"), keys: ["FK", "FK"], comment: "" } });
    // `decimal(10,2)` has a comma mermaid's attribute type cannot carry
    expect(ir).toBe(base);
    ir = applyErAction(base, { type: "addAttribute", entityId: E("o"), attribute: { ...attr("a3", "total", "decimal(10)"), keys: ["FK", "FK"], comment: "" } });
    expect(entity(ir, "o").attributes).toEqual([{ id: "a3", type: "decimal(10)", name: "total", keys: ["FK"] }]);

    ir = applyErAction(ir, { type: "updateAttribute", entityId: E("o"), id: A("a3"), keys: ["PK", "UK"], comment: "the total" });
    expect(entity(ir, "o").attributes[0]).toMatchObject({ keys: ["PK", "UK"], comment: "the total" });
    expect(applyErAction(ir, { type: "updateAttribute", entityId: E("o"), id: A("a3"), keys: ["PK", "UK"] })).toBe(ir);

    ir = applyErAction(ir, { type: "moveAttribute", entityId: E("c"), id: A("a2"), to: 0 });
    expect(entity(ir, "c").attributes.map((a) => a.id)).toEqual(["a2", "a1"]);
    expect(applyErAction(ir, { type: "moveAttribute", entityId: E("c"), id: A("a2"), to: -5 })).toBe(ir);

    ir = applyErAction(ir, { type: "removeAttribute", entityId: E("c"), id: A("a2") });
    expect(entity(ir, "c").attributes.map((a) => a.id)).toEqual(["a1"]);
  });

  it("rejects types and names mermaid cannot read", () => {
    for (const [type, name] of [["two words", "x"], ["int", "has space"], ["int", ""], ["", "x"], ["1int", "x"], ["int", "9x"]] as const) {
      expect(applyErAction(base, { type: "addAttribute", entityId: E("o"), attribute: attr("z", name, type) })).toBe(base);
    }
    expect(applyErAction(base, { type: "updateAttribute", entityId: E("c"), id: A("a1"), name: "bad name" })).toBe(base);
  });
});

describe("applyErAction: relationships", () => {
  const rel = { id: R("r"), from: E("c"), to: E("o"), fromCard: "exactly-one", toCard: "zero-or-more", identifying: true } as const;
  const wired = applyErAction(base, { type: "addRelationship", relationship: rel });

  it("adds between known entities only, self relationships included", () => {
    expect(wired.relationships).toHaveLength(1);
    expect(applyErAction(wired, { type: "addRelationship", relationship: rel })).toBe(wired);
    expect(applyErAction(base, { type: "addRelationship", relationship: { ...rel, to: E("nope") } })).toBe(base);
    expect(applyErAction(base, { type: "addRelationship", relationship: { ...rel, to: E("c") } }).relationships).toHaveLength(1);
  });

  it("updates cardinality, line kind and label, treating an empty label as unset", () => {
    let ir = applyErAction(wired, { type: "updateRelationship", id: R("r"), toCard: "one-or-more", identifying: false, label: "places" });
    expect(ir.relationships[0]).toMatchObject({ toCard: "one-or-more", identifying: false, label: "places" });
    expect(applyErAction(ir, { type: "updateRelationship", id: R("r"), label: "places" })).toBe(ir);
    ir = applyErAction(ir, { type: "updateRelationship", id: R("r"), label: "" });
    expect("label" in ir.relationships[0]!).toBe(false);
  });

  it("retargets, one end or both, and says why when it cannot", () => {
    const swapped = applyErAction(wired, { type: "retargetRelationship", id: R("r"), from: E("o"), to: E("c") });
    expect(swapped.relationships[0]).toMatchObject({ from: "o", to: "c" });
    expect(erRetargetRejection(wired, R("r"), { to: E("nope") })).toBe("unknown target");
    expect(erRetargetRejection(wired, R("zz"), {})).toBe("unknown relationship");
    expect(applyErAction(wired, { type: "retargetRelationship", id: R("r"), to: E("nope") })).toBe(wired);
  });

  it("sets the direction idempotently", () => {
    const lr = applyErAction(base, { type: "setDirection", direction: "LR" });
    expect(lr.direction).toBe("LR");
    expect(applyErAction(lr, { type: "setDirection", direction: "LR" })).toBe(lr);
  });
});
