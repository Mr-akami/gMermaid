import { describe, expect, it } from "vitest";
import type { ActorId, BoundaryId, NoteId, UseCaseId, UsecaseIR, UsecaseRelationId } from "@gmermaid/ir";
import { fixedWidthMeasurer } from "./measurer";
import { layoutUsecase } from "./usecase";

const A = (s: string) => s as ActorId;
const U = (s: string) => s as UseCaseId;
const B = (s: string) => s as BoundaryId;
const R = (s: string) => s as UsecaseRelationId;

const ir: UsecaseIR = {
  kind: "usecase",
  direction: "LR",
  actors: [{ id: A("Customer"), name: "Customer", variant: "default" }],
  usecases: [
    { id: U("Checkout"), name: "Checkout", shape: "ellipse", label: "Place order", boundary: B("sb") },
    { id: U("Receipt"), name: "Receipt", shape: "rect", boundary: B("sb") },
  ],
  boundaries: [{ id: B("sb"), name: "sb", label: "Order system", type: "package" }],
  relations: [
    { id: R("r1"), from: A("Customer"), to: U("Checkout"), line: "solid", headFrom: "none", headTo: "arrow", label: "buys" },
    { id: R("r2"), from: U("Checkout"), to: U("Receipt"), line: "dashed", headFrom: "none", headTo: "none", kind: "include" },
  ],
  notes: [{ id: "note-1" as NoteId, target: U("Checkout"), text: "validates the cart" }],
};

describe("layoutUsecase", () => {
  it("matches the committed golden layout", () => {
    expect(layoutUsecase(ir, fixedWidthMeasurer())).toMatchSnapshot();
  });

  it("wraps boundary members in a frame that also holds its title", () => {
    const result = layoutUsecase(ir, fixedWidthMeasurer());
    const frame = result.boundaries[0]!;
    for (const box of result.usecases) {
      expect(box.rect.x).toBeGreaterThanOrEqual(frame.rect.x);
      expect(box.rect.y).toBeGreaterThanOrEqual(frame.rect.y);
      expect(box.rect.x + box.rect.w).toBeLessThanOrEqual(frame.rect.x + frame.rect.w);
      expect(box.rect.y + box.rect.h).toBeLessThanOrEqual(frame.rect.y + frame.rect.h);
    }
    // the title band sits above the topmost member
    expect(Math.min(...result.usecases.map((u) => u.rect.y))).toBeGreaterThan(frame.rect.y);
    // include/extend name themselves on the edge
    expect(result.edges[1]!.label).toBe("«include»");
    expect(result.edges[0]!.label).toBe("buys");
  });

  it("lays an empty boundary out as a plain box", () => {
    const result = layoutUsecase(
      { ...ir, actors: [], usecases: [], relations: [], notes: [], boundaries: [{ id: B("sb"), name: "sb", type: "default" }] },
      fixedWidthMeasurer(),
    );
    expect(result.boundaries[0]!.rect.w).toBeGreaterThan(0);
    expect(Number.isFinite(result.size.w)).toBe(true);
  });

  it("routes self-relations as a detour that widens the canvas", () => {
    const selfIr: UsecaseIR = {
      ...ir,
      relations: [
        { id: R("r1"), from: U("Checkout"), to: U("Checkout"), line: "solid", headFrom: "none", headTo: "arrow", label: "retries" },
      ],
    };
    const result = layoutUsecase(selfIr, fixedWidthMeasurer());
    const box = result.usecases[0]!;
    const edge = result.edges[0]!;
    expect(edge.points).toHaveLength(4);
    expect(edge.points[0]!.x).toBe(box.rect.x + box.rect.w);
    expect(edge.points[1]!.x).toBeGreaterThan(box.rect.x + box.rect.w);
    expect(result.size.w).toBeGreaterThanOrEqual(edge.points[1]!.x);
  });

  it("returns finite sizes for an empty diagram", () => {
    const result = layoutUsecase(
      { kind: "usecase", actors: [], usecases: [], boundaries: [], relations: [], notes: [] },
      fixedWidthMeasurer(),
    );
    expect(result.size.w).toBeGreaterThan(0);
    expect(Number.isFinite(result.size.h)).toBe(true);
  });

  it("returns pure JSON data (ADR 0001 guard)", () => {
    const result = layoutUsecase(ir, fixedWidthMeasurer());
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
