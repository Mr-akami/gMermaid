import { describe, expect, it } from "vitest";
import type { ClassIR, ClassId, RelationId } from "@gmermaid/ir";
import { fixedWidthMeasurer } from "./measurer";
import { layoutClassDiagram } from "./classdiagram";

const ir: ClassIR = {
  kind: "class",
  classes: [
    {
      id: "Animal" as ClassId,
      name: "Animal",
      stereotype: "abstract",
      attributes: [{ name: "name", visibility: "protected", type: "String" }],
      methods: [{ name: "speak", visibility: "public", params: "", type: "String" }],
    },
    { id: "Dog" as ClassId, name: "Dog", attributes: [], methods: [] },
  ],
  relations: [{ id: "r1" as RelationId, from: "Dog" as ClassId, to: "Animal" as ClassId, type: "inheritance" }],
};

describe("layoutClassDiagram", () => {
  it("matches the committed golden layout", () => {
    expect(layoutClassDiagram(ir, fixedWidthMeasurer())).toMatchSnapshot();
  });

  it("keeps compartment separators inside the box", () => {
    const result = layoutClassDiagram(ir, fixedWidthMeasurer());
    for (const c of result.classes) {
      expect(c.headerBottom).toBeGreaterThan(c.rect.y);
      expect(c.attributesBottom).toBeGreaterThanOrEqual(c.headerBottom);
      expect(c.attributesBottom).toBeLessThan(c.rect.y + c.rect.h);
    }
  });

  it("returns finite sizes for an empty diagram", () => {
    const result = layoutClassDiagram({ kind: "class", classes: [], relations: [] }, fixedWidthMeasurer());
    expect(Number.isFinite(result.size.w)).toBe(true);
    expect(Number.isFinite(result.size.h)).toBe(true);
    expect(result.size.w).toBeGreaterThan(0);
  });

  it("routes self-relations as a rectangular detour off the node's right side", () => {
    const selfIr: ClassIR = {
      ...ir,
      relations: [
        { id: "r1" as RelationId, from: "Dog" as ClassId, to: "Dog" as ClassId, type: "association", label: "parent" },
        { id: "r2" as RelationId, from: "Dog" as ClassId, to: "Dog" as ClassId, type: "association" },
      ],
    };
    const result = layoutClassDiagram(selfIr, fixedWidthMeasurer());
    const dog = result.classes.find((c) => c.id === "Dog")!;
    const right = dog.rect.x + dog.rect.w;
    const [r1, r2] = result.relations;
    for (const r of [r1!, r2!]) {
      expect(r.points).toHaveLength(4);
      expect(r.points[0]!.x).toBe(right); // leaves the right edge…
      expect(r.points[3]!.x).toBe(right); // …and returns to it
      expect(r.points[1]!.x).toBeGreaterThan(right); // detour is outside the box
    }
    // stacked self-relations must not overlap
    expect(r2!.points[1]!.x).toBeGreaterThan(r1!.points[1]!.x);
    // the canvas covers the detour and its label (the -Infinity class of oversight)
    expect(result.size.w).toBeGreaterThanOrEqual(r2!.points[1]!.x);
    expect(r1!.labelPos!.x).toBeGreaterThan(right);
  });

  it("returns pure JSON data (ADR 0001 guard)", () => {
    const result = layoutClassDiagram(ir, fixedWidthMeasurer());
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
