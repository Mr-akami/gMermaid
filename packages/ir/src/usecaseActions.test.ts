import { describe, expect, it } from "vitest";
import type { ActorId, BoundaryId, NoteId, UseCaseId, UsecaseRelationId } from "./ids";
import type { UsecaseIR } from "./usecase";
import { emptyUsecaseDiagram } from "./usecase";
import { applyUsecaseAction, normalizeUsecaseRelation, usecaseNameRejection } from "./usecaseActions";

const A = (s: string) => s as ActorId;
const U = (s: string) => s as UseCaseId;
const B = (s: string) => s as BoundaryId;
const R = (s: string) => s as UsecaseRelationId;

function base(): UsecaseIR {
  let ir = emptyUsecaseDiagram();
  ir = applyUsecaseAction(ir, { type: "addBoundary", boundary: { id: B("sb"), name: "sb", label: "System", type: "default" } });
  ir = applyUsecaseAction(ir, { type: "addActor", actor: { id: A("Customer"), name: "Customer", variant: "default" } });
  ir = applyUsecaseAction(ir, {
    type: "addUseCase",
    usecase: { id: U("Checkout"), name: "Checkout", shape: "ellipse", boundary: B("sb") },
  });
  return ir;
}

describe("applyUsecaseAction", () => {
  it("rejects duplicate and non-mermaid names across all three collections", () => {
    const ir = base();
    expect(applyUsecaseAction(ir, { type: "addActor", actor: { id: A("x"), name: "Checkout", variant: "default" } })).toBe(ir);
    expect(applyUsecaseAction(ir, { type: "addUseCase", usecase: { id: U("y"), name: "sb", shape: "ellipse" } })).toBe(ir);
    expect(applyUsecaseAction(ir, { type: "addActor", actor: { id: A("z"), name: "has space", variant: "default" } })).toBe(ir);
    expect(applyUsecaseAction(ir, { type: "renameNode", id: A("Customer"), name: "sb" })).toBe(ir);
  });

  it("keeps members when a boundary goes away, and drops relations with a node", () => {
    let ir = base();
    ir = applyUsecaseAction(ir, {
      type: "addRelation",
      relation: { id: R("r1"), from: A("Customer"), to: U("Checkout"), line: "solid", headFrom: "none", headTo: "arrow" },
    });
    ir = applyUsecaseAction(ir, { type: "addNote", note: { id: "n1" as NoteId, target: U("Checkout"), text: "hi" } });

    const without = applyUsecaseAction(ir, { type: "removeBoundary", id: B("sb") });
    expect(without.boundaries).toEqual([]);
    expect(without.usecases[0]!.boundary).toBeUndefined();
    expect(without.relations).toHaveLength(1);

    const gone = applyUsecaseAction(ir, { type: "removeNode", id: U("Checkout") });
    expect(gone.usecases).toEqual([]);
    expect(gone.relations).toEqual([]);
    expect(gone.notes).toEqual([]);
  });

  it("refuses membership in an unknown boundary and notes on unknown targets", () => {
    const ir = base();
    expect(applyUsecaseAction(ir, { type: "setNodeBoundary", id: A("Customer"), boundary: B("nope") })).toBe(ir);
    expect(applyUsecaseAction(ir, { type: "addNote", note: { id: "n" as NoteId, target: U("nope"), text: "x" } })).toBe(ir);
    const moved = applyUsecaseAction(ir, { type: "setNodeBoundary", id: A("Customer"), boundary: B("sb") });
    expect(moved.actors[0]!.boundary).toBe("sb");
    expect(applyUsecaseAction(moved, { type: "setNodeBoundary", id: A("Customer"), boundary: null }).actors[0]!.boundary).toBeUndefined();
  });

  it("drops the business slash where mermaid rejects it", () => {
    let ir = base();
    ir = applyUsecaseAction(ir, {
      type: "addActor",
      actor: { id: A("Robot"), name: "Robot", variant: "awesome", business: true },
    });
    expect(ir.actors.find((a) => a.name === "Robot")!.business).toBeUndefined();
    ir = applyUsecaseAction(ir, { type: "updateUseCase", id: U("Checkout"), business: true });
    expect(ir.usecases[0]!.business).toBe(true);
    // turning the same use case into a rectangle clears the flag again
    ir = applyUsecaseAction(ir, { type: "updateUseCase", id: U("Checkout"), shape: "rect" });
    expect(ir.usecases[0]!.business).toBeUndefined();
  });

  it("normalizes relations into shapes mermaid can spell", () => {
    // include/extend is the only dashed line: no markers, no label
    expect(
      normalizeUsecaseRelation({
        id: R("r"),
        from: U("a"),
        to: U("b"),
        line: "solid",
        headFrom: "arrow",
        headTo: "arrow",
        label: "x",
        kind: "include",
      }),
    ).toEqual({ id: "r", from: "a", to: "b", line: "dashed", headFrom: "none", headTo: "none", kind: "include" });

    // a marker on both ends is not spellable — the source end gives way
    expect(
      normalizeUsecaseRelation({ id: R("r"), from: U("a"), to: U("b"), line: "solid", headFrom: "circle", headTo: "arrow" }).headFrom,
    ).toBe("none");

    // generalization exists in the `--|>` direction only: mirror it instead
    const mirrored = normalizeUsecaseRelation({
      id: R("r"),
      from: U("a"),
      to: U("b"),
      line: "solid",
      headFrom: "inheritance",
      headTo: "none",
      label: "dropped",
    });
    expect(mirrored).toEqual({ id: "r", from: "b", to: "a", line: "solid", headFrom: "none", headTo: "inheritance" });
  });

  it("updateRelation clears the opposite marker and can undo include/extend", () => {
    let ir = base();
    ir = applyUsecaseAction(ir, {
      type: "addRelation",
      relation: { id: R("r1"), from: A("Customer"), to: U("Checkout"), line: "solid", headFrom: "none", headTo: "arrow" },
    });
    ir = applyUsecaseAction(ir, { type: "updateRelation", id: R("r1"), headFrom: "circle" });
    expect([ir.relations[0]!.headFrom, ir.relations[0]!.headTo]).toEqual(["circle", "none"]);

    ir = applyUsecaseAction(ir, { type: "updateRelation", id: R("r1"), relationKind: "extend" });
    expect(ir.relations[0]!.line).toBe("dashed");
    expect(ir.relations[0]!.headFrom).toBe("none");

    ir = applyUsecaseAction(ir, { type: "updateRelation", id: R("r1"), relationKind: "", headTo: "arrow" });
    expect(ir.relations[0]!.kind).toBeUndefined();
    expect(ir.relations[0]!.line).toBe("solid");
    expect(ir.relations[0]!.headTo).toBe("arrow");
  });

  it("returns the same object when nothing changes (reference identity)", () => {
    const ir = base();
    expect(applyUsecaseAction(ir, { type: "updateActor", id: A("Customer"), variant: "default" })).toBe(ir);
    expect(applyUsecaseAction(ir, { type: "removeRelation", id: R("nope") })).toBe(ir);
    expect(applyUsecaseAction(ir, { type: "setDirection", direction: "TB" })).not.toBe(ir);
  });

  // A declaration line is just the name, so a keyword name is read as that
  // statement: `end` closes the boundary, `class` is dropped with its line.
  it("refuses names the mermaid text claims for itself", () => {
    const ir = base();
    for (const name of ["end", "systemBoundary", "class", "style", "accTitle", "note", "actor"]) {
      expect(usecaseNameRejection(name), name).toBeDefined();
      expect(applyUsecaseAction(ir, { type: "renameNode", id: U("Checkout"), name }), name).toBe(ir);
      expect(
        applyUsecaseAction(ir, { type: "addUseCase", usecase: { id: U("x"), name, shape: "ellipse" } }),
        name,
      ).toBe(ir);
    }
    expect(usecaseNameRejection("Checkout2")).toBeUndefined();
  });
});
