import { describe, expect, it } from "vitest";
import type { ClassIR, ClassId, NamespaceId, NoteId, RelationId } from "@gmermaid/ir";
import { fixedWidthMeasurer } from "./measurer";
import { layoutClassDiagram } from "./classdiagram";

const ir: ClassIR = {
  kind: "class",
  classes: [
    {
      id: "Animal" as ClassId,
      name: "Animal",
      stereotypes: ["abstract"],
      attributes: [{ name: "name", visibility: "protected", type: "String" }],
      methods: [{ name: "speak", visibility: "public", params: "", type: "String" }],
    },
    { id: "Dog" as ClassId, name: "Dog", stereotypes: [], attributes: [], methods: [] },
  ],
  relations: [
    { id: "r1" as RelationId, from: "Dog" as ClassId, to: "Animal" as ClassId, line: "solid", headFrom: "none", headTo: "inheritance" },
  ],
  notes: [],
  namespaces: [],
};

const empty: ClassIR = { kind: "class", classes: [], relations: [], notes: [], namespaces: [] };

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
    const result = layoutClassDiagram(empty, fixedWidthMeasurer());
    expect(Number.isFinite(result.size.w)).toBe(true);
    expect(Number.isFinite(result.size.h)).toBe(true);
    expect(result.size.w).toBeGreaterThan(0);
  });

  it("routes self-relations as a rectangular detour off the node's right side", () => {
    const selfIr: ClassIR = {
      ...ir,
      relations: [
        { id: "r1" as RelationId, from: "Dog" as ClassId, to: "Dog" as ClassId, line: "solid", headFrom: "none", headTo: "arrow", label: "parent" },
        { id: "r2" as RelationId, from: "Dog" as ClassId, to: "Dog" as ClassId, line: "solid", headFrom: "none", headTo: "arrow" },
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

  it("carries classifiers as styling and shows the label instead of the name", () => {
    const styled: ClassIR = {
      ...ir,
      classes: [
        {
          id: "A" as ClassId,
          name: "A",
          label: "Class A",
          generic: "T",
          stereotypes: [],
          attributes: [{ name: "n", visibility: "public", type: "List~int~", static: true }],
          methods: [{ name: "run", visibility: "public", params: "", abstract: true }],
        },
      ],
      relations: [],
    };
    const box = layoutClassDiagram(styled, fixedWidthMeasurer()).classes[0]!;
    expect(box.name).toBe("Class A"); // the label wins over `A<T>`
    // `$`/`*` never reach the text: they are underline / italics
    expect(box.attributes).toEqual([{ text: "+List<int> n", static: true, abstract: false }]);
    expect(box.methods).toEqual([{ text: "+run()", static: false, abstract: true }]);
  });

  it("frames a namespace around its members", () => {
    const withNs: ClassIR = {
      ...ir,
      namespaces: [{ id: "N" as NamespaceId, name: "N" }],
      classes: ir.classes.map((c) => (c.id === "Animal" ? { ...c, namespace: "N" as NamespaceId } : c)),
    };
    const result = layoutClassDiagram(withNs, fixedWidthMeasurer());
    const frame = result.namespaces[0]!;
    const animal = result.classes.find((c) => c.id === "Animal")!;
    expect(frame.rect.x).toBeLessThan(animal.rect.x);
    expect(frame.rect.y).toBeLessThan(animal.rect.y);
    expect(frame.rect.x + frame.rect.w).toBeGreaterThan(animal.rect.x + animal.rect.w);
    expect(frame.rect.y + frame.rect.h).toBeGreaterThan(animal.rect.y + animal.rect.h);
    expect(result.size.w).toBeGreaterThanOrEqual(frame.rect.x + frame.rect.w);
  });

  it("places notes as nodes and links an attached one to its target", () => {
    const withNotes: ClassIR = {
      ...ir,
      notes: [
        { id: "n1" as NoteId, text: "about the dog", target: "Dog" as ClassId },
        { id: "n2" as NoteId, text: "floating" },
      ],
    };
    const result = layoutClassDiagram(withNotes, fixedWidthMeasurer());
    const [attached, free] = result.notes;
    expect(attached!.rect.w).toBeGreaterThan(0);
    expect(attached!.link!.length).toBeGreaterThan(1);
    expect(free!.link).toBeUndefined();
  });

  it("returns pure JSON data (ADR 0001 guard)", () => {
    const rich: ClassIR = {
      ...ir,
      namespaces: [{ id: "N" as NamespaceId, name: "N" }],
      classes: ir.classes.map((c) => (c.id === "Animal" ? { ...c, namespace: "N" as NamespaceId } : c)),
      notes: [{ id: "n1" as NoteId, text: "hi", target: "Dog" as ClassId }],
    };
    const result = layoutClassDiagram(rich, fixedWidthMeasurer());
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
