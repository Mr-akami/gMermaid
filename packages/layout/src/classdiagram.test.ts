import { describe, expect, it } from "vitest";
import type { ClassIR, ClassId, NamespaceId, NoteId, RelationId } from "@gmermaid/ir";
import { fixedWidthMeasurer } from "./measurer";
import { layoutClassDiagram, NAMESPACE_TITLE_BAND } from "./classdiagram";

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

const cls = (name: string, namespace?: NamespaceId) => ({
  id: name as ClassId,
  name,
  stereotypes: [],
  attributes: [],
  methods: [],
  ...(namespace !== undefined ? { namespace } : {}),
});

const pair = (namespace?: NamespaceId): ClassIR => ({
  kind: "class",
  direction: "TB",
  classes: [cls("Alpha", namespace), cls("Beta", namespace)],
  relations: [
    { id: "r1" as RelationId, from: "Alpha" as ClassId, to: "Beta" as ClassId, line: "solid", headFrom: "none", headTo: "arrow" },
  ],
  namespaces: namespace !== undefined ? [{ id: namespace, name: "ns" }] : [],
  notes: [],
});

/** Distance dagre left between the two related classes. */
const classGap = (source: ClassIR): number => {
  const l = layoutClassDiagram(source, fixedWidthMeasurer());
  const box = (id: string) => l.classes.find((c) => c.id === id)!.rect;
  return box("Beta").y - (box("Alpha").y + box("Alpha").h);
};

describe("a namespace frame costs nothing outside itself", () => {
  it("keeps the rank gap the same inside a frame as outside one", () => {
    // a dagre cluster adds border ranks: the same two classes used to sit 3x
    // further apart once a namespace was drawn around them
    expect(classGap(pair("ns" as NamespaceId))).toBeCloseTo(classGap(pair()), 6);
  });

  it("insets the members inside the frame, title band clear", () => {
    const l = layoutClassDiagram(pair("ns" as NamespaceId), fixedWidthMeasurer());
    const frame = l.namespaces[0]!.rect;
    for (const c of l.classes) {
      expect(c.rect.x).toBeGreaterThan(frame.x);
      expect(c.rect.x + c.rect.w).toBeLessThanOrEqual(frame.x + frame.w);
      expect(c.rect.y).toBeGreaterThanOrEqual(frame.y + NAMESPACE_TITLE_BAND);
      expect(c.rect.y + c.rect.h).toBeLessThanOrEqual(frame.y + frame.h);
    }
    expect(JSON.parse(JSON.stringify(l))).toEqual(l);
  });

  it("carries a note's link across the frame to the class it names", () => {
    const withNote: ClassIR = {
      ...pair("ns" as NamespaceId),
      notes: [{ id: "note-1" as NoteId, text: "a note", target: "Alpha" as ClassId }],
    };
    const l = layoutClassDiagram(withNote, fixedWidthMeasurer());
    const target = l.classes.find((c) => c.id === "Alpha")!.rect;
    const link = l.notes[0]!.link!;
    const tip = link.at(-1)!;
    const onBorder =
      Math.abs(tip.x - target.x) < 0.01 ||
      Math.abs(tip.x - (target.x + target.w)) < 0.01 ||
      Math.abs(tip.y - target.y) < 0.01 ||
      Math.abs(tip.y - (target.y + target.h)) < 0.01;
    expect(onBorder).toBe(true);
  });
});
