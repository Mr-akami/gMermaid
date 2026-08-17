import { describe, expect, it } from "vitest";
import type { ClassIR, ClassId, RelationId } from "@gmermaid/ir";
import { classToMermaid } from "@gmermaid/mermaid-codegen";
import { parseClassDiagram } from "./classdiagram";

const C = (s: string) => s as ClassId;

describe("parseClassDiagram", () => {
  it("parses class blocks, members, stereotypes, and relations", () => {
    const result = parseClassDiagram(
      `classDiagram
  class Animal {
    <<abstract>>
    #name : String
    +speak() : String
  }
  class Dog
  Dog --|> Animal
  Owner "1" --> "0..*" Dog : owns
`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.classes.map((c) => c.name)).toEqual(["Animal", "Dog", "Owner"]);
    const animal = result.ir.classes[0]!;
    expect(animal.stereotype).toBe("abstract");
    expect(animal.attributes).toEqual([{ name: "name", visibility: "protected", type: "String" }]);
    expect(animal.methods).toEqual([{ name: "speak", visibility: "public", params: "", type: "String" }]);
    expect(result.ir.relations).toEqual([
      { id: "relation-1", from: "Dog", to: "Animal", type: "inheritance" },
      { id: "relation-2", from: "Owner", to: "Dog", type: "association", label: "owns", fromCardinality: "1", toCardinality: "0..*" },
    ]);
  });

  it("reports bad member lines and unclosed blocks", () => {
    const result = parseClassDiagram(`classDiagram\n  class X {\n    ???\n`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.message)).toEqual([
      expect.stringContaining("cannot parse member"),
      expect.stringContaining("unclosed class block"),
    ]);
  });

  it("round-trips: parse(gen(ir)) == ir when ids are names, and gen is stable", () => {
    const ir: ClassIR = {
      kind: "class",
      classes: [
        {
          id: C("Shape"),
          name: "Shape",
          stereotype: "interface",
          attributes: [{ name: "area", visibility: "private", type: "double" }],
          methods: [{ name: "draw", visibility: "public", params: "ctx: Ctx", type: "void" }],
        },
        { id: C("Circle"), name: "Circle", attributes: [], methods: [] },
      ],
      relations: [
        { id: "relation-1" as RelationId, from: C("Circle"), to: C("Shape"), type: "realization" },
        {
          id: "relation-2" as RelationId,
          from: C("Shape"),
          to: C("Circle"),
          type: "dependency",
          label: "creates",
          fromCardinality: "1",
          toCardinality: "*",
        },
      ],
    };
    const code = classToMermaid(ir);
    const back = parseClassDiagram(code);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.ir).toEqual(ir);
    expect(classToMermaid(back.ir)).toBe(code);
  });
});
