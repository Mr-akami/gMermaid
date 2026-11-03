import { describe, expect, it } from "vitest";
import type { QuadrantPointId } from "./ids";
import { clampUnit, emptyQuadrant, quadrantLabelRejection, sanitizeQuadrantText, type QuadrantIR } from "./quadrant";
import { applyQuadrantAction } from "./quadrantActions";

const P = (s: string) => s as QuadrantPointId;

const base: QuadrantIR = {
  ...emptyQuadrant(),
  title: "Reach",
  points: [
    { id: P("p1"), label: "A", x: 0.3, y: 0.6 },
    { id: P("p2"), label: "B", x: 0.8, y: 0.2 },
  ],
};

describe("applyQuadrantAction", () => {
  it("sets and clears the title; same value is identity", () => {
    expect(applyQuadrantAction(base, { type: "setTitle", title: "Reach" })).toBe(base);
    expect(applyQuadrantAction(base, { type: "setTitle", title: "  New \"one\" " }).title).toBe("New 'one'");
    expect("title" in applyQuadrantAction(base, { type: "setTitle", title: " " })).toBe(false);
  });

  it("sets one end of an axis without touching the other", () => {
    const a = applyQuadrantAction(base, { type: "setAxis", axis: "x", low: "Cheap" });
    expect(a.xAxis).toEqual({ low: "Cheap", high: "" });
    const b = applyQuadrantAction(a, { type: "setAxis", axis: "x", high: "Pricey" });
    expect(b.xAxis).toEqual({ low: "Cheap", high: "Pricey" });
    expect(b.yAxis).toBe(base.yAxis);
    expect(applyQuadrantAction(b, { type: "setAxis", axis: "x", low: "Cheap" })).toBe(b);
  });

  it("labels one quadrant by index", () => {
    const a = applyQuadrantAction(base, { type: "setQuadrantLabel", index: 2, label: "Drop" });
    expect(a.quadrants).toEqual(["", "", "Drop", ""]);
    expect(applyQuadrantAction(a, { type: "setQuadrantLabel", index: 2, label: "Drop" })).toBe(a);
  });

  it("adds a point, clamped, and refuses an empty name or a duplicate id", () => {
    const a = applyQuadrantAction(base, { type: "addPoint", point: { id: P("p3"), label: " C ", x: 2, y: -1 } });
    expect(a.points[2]).toEqual({ id: "p3", label: "C", x: 1, y: 0 });
    expect(applyQuadrantAction(base, { type: "addPoint", point: { id: P("p9"), label: "  ", x: 0.5, y: 0.5 } })).toBe(base);
    expect(applyQuadrantAction(base, { type: "addPoint", point: { id: P("p1"), label: "dup", x: 0.5, y: 0.5 } })).toBe(base);
  });

  it("moves a point: clamps and rounds, identity when nothing changes", () => {
    const a = applyQuadrantAction(base, { type: "movePoint", id: P("p1"), x: 0.123456, y: 1.7 });
    expect(a.points[0]).toMatchObject({ x: 0.1235, y: 1 });
    expect(a.points[1]).toBe(base.points[1]);
    expect(applyQuadrantAction(base, { type: "movePoint", id: P("p1"), x: 0.3, y: 0.6 })).toBe(base);
    expect(applyQuadrantAction(base, { type: "movePoint", id: P("nope"), x: 0.3, y: 0.6 })).toBe(base);
  });

  it("renames a point but never to nothing", () => {
    expect(applyQuadrantAction(base, { type: "updatePoint", id: P("p1"), label: "Z" }).points[0]!.label).toBe("Z");
    expect(applyQuadrantAction(base, { type: "updatePoint", id: P("p1"), label: " " })).toBe(base);
  });

  it("removes a point", () => {
    expect(applyQuadrantAction(base, { type: "removePoint", id: P("p1") }).points.map((p) => p.id)).toEqual(["p2"]);
    expect(applyQuadrantAction(base, { type: "removePoint", id: P("zz") })).toBe(base);
  });
});

describe("text and unit helpers", () => {
  it("sanitizes what the quoted form cannot carry", () => {
    expect(sanitizeQuadrantText('a "b"\n  c')).toBe("a 'b' c");
    expect(quadrantLabelRejection("   ")).toMatch(/name/);
    expect(quadrantLabelRejection("x")).toBeUndefined();
  });

  it("clamps to 0..1 at 4 decimals; NaN is the middle", () => {
    expect(clampUnit(-3)).toBe(0);
    expect(clampUnit(3)).toBe(1);
    expect(clampUnit(0.123449)).toBe(0.1234);
    expect(clampUnit(Number.NaN)).toBe(0.5);
  });
});
