import { describe, expect, it } from "vitest";
import type { ClassId, NamespaceId, NoteId, RelationId } from "./ids";
import type { ClassIR } from "./classdiagram";
import { applyClassAction } from "./classActions";

const C = (s: string) => s as ClassId;
const R = (s: string) => s as RelationId;
const NS = (s: string) => s as NamespaceId;
const NT = (s: string) => s as NoteId;

const base: ClassIR = {
  kind: "class",
  classes: [
    { id: C("TreeNode"), name: "TreeNode", stereotypes: [], attributes: [{ name: "value", visibility: "public" }], methods: [] },
    { id: C("Other"), name: "Other", stereotypes: [], attributes: [], methods: [] },
  ],
  relations: [],
  notes: [],
  namespaces: [],
};

describe("applyClassAction", () => {
  it("allows self-relations (TreeNode → TreeNode)", () => {
    const next = applyClassAction(base, {
      type: "addRelation",
      relation: { id: R("r1"), from: C("TreeNode"), to: C("TreeNode"), line: "solid", headFrom: "none", headTo: "arrow", label: "children" },
    });
    expect(next.relations).toEqual([
      { id: "r1", from: "TreeNode", to: "TreeNode", line: "solid", headFrom: "none", headTo: "arrow", label: "children" },
    ]);
  });

  it("updates line and each head independently", () => {
    const withRel = applyClassAction(base, {
      type: "addRelation",
      relation: { id: R("r1"), from: C("TreeNode"), to: C("Other"), line: "solid", headFrom: "none", headTo: "arrow" },
    });
    const reversed = applyClassAction(withRel, { type: "updateRelation", id: R("r1"), headFrom: "inheritance", headTo: "none" });
    expect(reversed.relations[0]).toMatchObject({ headFrom: "inheritance", headTo: "none", line: "solid" });
    const dashed = applyClassAction(reversed, { type: "updateRelation", id: R("r1"), line: "dashed" });
    expect(dashed.relations[0]).toMatchObject({ line: "dashed", headFrom: "inheritance" });
    // no-op updates keep identity
    expect(applyClassAction(dashed, { type: "updateRelation", id: R("r1"), line: "dashed" })).toBe(dashed);
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

  it("setMembers rejects a type that would read back as a classifier", () => {
    for (const type of ["int$", "int*", ""]) {
      const next = applyClassAction(base, {
        type: "setMembers",
        id: C("TreeNode"),
        attributes: [{ name: "x", visibility: "public", type }],
        methods: [],
      });
      expect(next).toBe(base);
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

  it("setMembers rejects a method that is both abstract and static (mermaid takes one classifier)", () => {
    const next = applyClassAction(base, {
      type: "setMembers",
      id: C("TreeNode"),
      attributes: [],
      methods: [{ name: "run", visibility: "public", params: "", abstract: true, static: true }],
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
    const withLabel = applyClassAction(base, { type: "setClassLabel", id: C("TreeNode"), label: "Tree node" });
    expect(withLabel.classes[0]).toHaveProperty("label", "Tree node");
    const cleared = applyClassAction(withLabel, { type: "setClassLabel", id: C("TreeNode"), label: "" });
    expect("label" in cleared.classes[0]!).toBe(false);

    const withRel = applyClassAction(base, {
      type: "addRelation",
      relation: { id: R("r1"), from: C("TreeNode"), to: C("Other"), line: "solid", headFrom: "none", headTo: "arrow", label: "x" },
    });
    const relCleared = applyClassAction(withRel, { type: "updateRelation", id: R("r1"), label: "" });
    expect("label" in relCleared.relations[0]!).toBe(false);
  });

  it("keeps annotations as an ordered list and drops blank ones", () => {
    const next = applyClassAction(base, { type: "setStereotypes", id: C("TreeNode"), stereotypes: ["interface", " ", "service"] });
    expect(next.classes[0]!.stereotypes).toEqual(["interface", "service"]);
    expect(applyClassAction(next, { type: "setStereotypes", id: C("TreeNode"), stereotypes: ["interface", "service"] })).toBe(next);
  });

  it("accepts names mermaid can express and rejects the ones it cannot", () => {
    const ok = applyClassAction(base, { type: "renameClass", id: C("TreeNode"), name: "Animal Class!" });
    expect(ok.classes[0]!.name).toBe("Animal Class!");
    for (const name of ["", "  ", "back`tick", "gen~eric", "a\nb"]) {
      expect(applyClassAction(base, { type: "renameClass", id: C("TreeNode"), name })).toBe(base);
    }
  });
});

describe("class notes", () => {
  it("adds free and attached notes, and rejects an unknown target", () => {
    const free = applyClassAction(base, { type: "addNote", note: { id: NT("n1"), text: "hi" } });
    expect(free.notes).toEqual([{ id: "n1", text: "hi" }]);
    const attached = applyClassAction(free, { type: "addNote", note: { id: NT("n2"), text: "yo", target: C("TreeNode") } });
    expect(attached.notes[1]).toEqual({ id: "n2", text: "yo", target: "TreeNode" });
    expect(applyClassAction(attached, { type: "addNote", note: { id: NT("n3"), text: "x", target: C("Ghost") } })).toBe(attached);
  });

  it("detaches a note with target: null and drops notes of a deleted class", () => {
    const attached = applyClassAction(base, { type: "addNote", note: { id: NT("n1"), text: "yo", target: C("TreeNode") } });
    const detached = applyClassAction(attached, { type: "updateNote", id: NT("n1"), target: null });
    expect("target" in detached.notes[0]!).toBe(false);
    const removed = applyClassAction(attached, { type: "removeClass", id: C("TreeNode") });
    expect(removed.notes).toEqual([]);
  });
});

describe("class namespaces", () => {
  const withNs = applyClassAction(base, {
    type: "addNamespace",
    namespace: { id: NS("ns1"), name: "Shapes" },
    classes: [C("TreeNode")],
  });

  it("is created around its first members (mermaid rejects an empty one)", () => {
    expect(withNs.namespaces).toEqual([{ id: "ns1", name: "Shapes" }]);
    expect(withNs.classes[0]!.namespace).toBe("ns1");
    expect(applyClassAction(base, { type: "addNamespace", namespace: { id: NS("ns2"), name: "Empty" }, classes: [] })).toBe(base);
  });

  it("prunes itself once its last member leaves", () => {
    const moved = applyClassAction(withNs, { type: "setClassNamespace", id: C("TreeNode") });
    expect(moved.namespaces).toEqual([]);
    expect("namespace" in moved.classes[0]!).toBe(false);
  });

  it("releases its members when deleted", () => {
    const gone = applyClassAction(withNs, { type: "removeNamespace", id: NS("ns1") });
    expect(gone.namespaces).toEqual([]);
    expect("namespace" in gone.classes[0]!).toBe(false);
  });

  it("rejects an unknown namespace on a class", () => {
    expect(applyClassAction(withNs, { type: "setClassNamespace", id: C("Other"), namespace: NS("ghost") })).toBe(withNs);
  });
});
