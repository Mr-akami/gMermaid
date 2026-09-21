import { describe, expect, it } from "vitest";
import type { ClassIR, ClassId, NamespaceId, NoteId, RelationId } from "@gmermaid/ir";
import { classToMermaid } from "@gmermaid/mermaid-codegen";
import { parseClassDiagram, parseMemberLine } from "./classdiagram";

const C = (s: string) => s as ClassId;

/** parse → codegen → parse must be a fixed point (ids are names on import). */
function expectRoundTrip(ir: ClassIR): void {
  const code = classToMermaid(ir);
  const back = parseClassDiagram(code);
  expect(back.ok, JSON.stringify(back)).toBe(true);
  if (!back.ok) return;
  expect(back.ir).toEqual(ir);
  expect(classToMermaid(back.ir)).toBe(code);
}

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
    expect(animal.stereotypes).toEqual(["abstract"]);
    expect(animal.attributes).toEqual([{ name: "name", visibility: "protected", type: "String" }]);
    expect(animal.methods).toEqual([{ name: "speak", visibility: "public", params: "", type: "String" }]);
    expect(result.ir.relations).toEqual([
      { id: "relation-1", from: "Dog", to: "Animal", line: "solid", headFrom: "none", headTo: "inheritance" },
      {
        id: "relation-2",
        from: "Owner",
        to: "Dog",
        line: "solid",
        headFrom: "none",
        headTo: "arrow",
        label: "owns",
        fromCardinality: "1",
        toCardinality: "0..*",
      },
    ]);
  });

  it("reports bad member lines and unclosed blocks", () => {
    const result = parseClassDiagram(`classDiagram\n  class X {\n    ?? ??\n`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.message)).toEqual([
      expect.stringContaining("cannot parse member"),
      expect.stringContaining("unclosed class block"),
    ]);
  });

  it("round-trips: parse(gen(ir)) == ir when ids are names, and gen is stable", () => {
    expectRoundTrip({
      kind: "class",
      classes: [
        {
          id: C("Shape"),
          name: "Shape",
          stereotypes: ["interface"],
          attributes: [{ name: "area", visibility: "private", type: "double" }],
          methods: [{ name: "draw", visibility: "public", params: "ctx: Ctx", type: "void" }],
        },
        { id: C("Circle"), name: "Circle", stereotypes: [], attributes: [], methods: [] },
      ],
      relations: [
        { id: "relation-1" as RelationId, from: C("Circle"), to: C("Shape"), line: "dashed", headFrom: "none", headTo: "inheritance" },
        {
          id: "relation-2" as RelationId,
          from: C("Shape"),
          to: C("Circle"),
          line: "dashed",
          headFrom: "none",
          headTo: "arrow",
          label: "creates",
          fromCardinality: "1",
          toCardinality: "*",
        },
      ],
      notes: [],
      namespaces: [],
    });
  });

  it("parses direction, one-line annotations, inline members and plain links", () => {
    const code = `classDiagram
  direction LR
  class Shape
  <<interface>> Shape
  Shape : +area() float
  Shape -- Circle
  Shape .. Square : note
`;
    const result = parseClassDiagram(code);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.direction).toBe("LR");
    expect(result.ir.classes[0]).toMatchObject({
      name: "Shape",
      stereotypes: ["interface"],
      methods: [{ name: "area", params: "", type: "float", visibility: "public" }],
    });
    expect(result.ir.relations.map((r) => [r.line, r.headFrom, r.headTo, r.label])).toEqual([
      ["solid", "none", "none", undefined],
      ["dashed", "none", "none", "note"],
    ]);
    expectRoundTrip(result.ir);
  });

  it("accepts the -v2 header and maps `direction TD` onto TB", () => {
    const result = parseClassDiagram("classDiagram-v2\n  direction TD\n  A --> B\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.direction).toBe("TB");
  });
});

/** "from line headFrom headTo to" for the single relation in `code`. */
function heads(code: string): string | null {
  const r = parseClassDiagram(`classDiagram\n  ${code}\n`);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  if (!r.ok) return null;
  const rel = r.ir.relations[0]!;
  return [rel.from, rel.line, rel.headFrom, rel.headTo, rel.to].join(" ");
}

describe("relation tokens", () => {
  it("parses forward tokens", () => {
    expect(heads("A --|> B")).toBe("A solid none inheritance B");
    expect(heads("A ..|> B")).toBe("A dashed none inheritance B");
    expect(heads("A --* B")).toBe("A solid none composition B");
    expect(heads("A --o B")).toBe("A solid none aggregation B");
    expect(heads("A --> B")).toBe("A solid none arrow B");
    expect(heads("A ..> B")).toBe("A dashed none arrow B");
  });

  it("parses reversed tokens without swapping from/to", () => {
    // the head moves to the OTHER end; the ends keep their source order so
    // the emitted token is identical on the way back out
    expect(heads("A <|-- B")).toBe("A solid inheritance none B");
    expect(heads("A *-- B")).toBe("A solid composition none B");
    expect(heads("A o-- B")).toBe("A solid aggregation none B");
    expect(heads("A <-- B")).toBe("A solid arrow none B");
    expect(heads("A <.. B")).toBe("A dashed arrow none B");
    expect(heads("A <|.. B")).toBe("A dashed inheritance none B");
  });

  it("parses two-way tokens", () => {
    expect(heads("A <|--|> B")).toBe("A solid inheritance inheritance B");
    expect(heads("A <--> B")).toBe("A solid arrow arrow B");
    expect(heads("A *--* B")).toBe("A solid composition composition B");
    expect(heads("A o--o B")).toBe("A solid aggregation aggregation B");
    expect(heads("A <..> B")).toBe("A dashed arrow arrow B");
    expect(heads("A <|..|> B")).toBe("A dashed inheritance inheritance B");
  });

  it("parses lollipop ends", () => {
    expect(heads("A --() Bar")).toBe("A solid none lollipop Bar");
    expect(heads("Bar ()-- A")).toBe("Bar solid lollipop none A");
  });

  it("round-trips every token shape", () => {
    const code = `classDiagram
  class A
  class B
  A <|-- B
  A <--> B
  A *--* B
  A o..o B
  A --() B
  B ()-- A
`;
    const result = parseClassDiagram(code);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectRoundTrip(result.ir);
    expect(classToMermaid(result.ir)).toContain("A <|-- B");
    expect(classToMermaid(result.ir)).toContain("A --() B");
  });
});

describe("class names, labels and generics", () => {
  it("parses labels, backtick names, dashes and unicode", () => {
    const code = `classDiagram
  class X["Label text"]
  class \`Animal Class!\`
  class my-class
  class 動物
  \`Animal Class!\` --> 動物
`;
    const result = parseClassDiagram(code);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.ir.classes.map((c) => c.name)).toEqual(["X", "Animal Class!", "my-class", "動物"]);
    expect(result.ir.classes[0]!.label).toBe("Label text");
    expectRoundTrip(result.ir);
    // a name mermaid cannot tokenize bare comes back out in backticks
    expect(classToMermaid(result.ir)).toContain("class `Animal Class!`");
    expect(classToMermaid(result.ir)).toContain("`Animal Class!` --> 動物");
  });

  it("parses generic class names and a label with a block", () => {
    const result = parseClassDiagram(`classDiagram\n  class Square~Shape~ {\n    +int id\n  }\n  Square --> X\n`);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.ir.classes[0]).toMatchObject({ name: "Square", generic: "Shape" });
    expectRoundTrip(result.ir);
  });

  it("escapes and restores quotes and newlines in labels", () => {
    const ir: ClassIR = {
      kind: "class",
      classes: [{ id: C("X"), name: "X", label: 'a "q" <b>\nsecond', stereotypes: [], attributes: [], methods: [] }],
      relations: [],
      notes: [],
      namespaces: [],
    };
    expectRoundTrip(ir);
  });
});

describe("members", () => {
  it("parses both attribute dialects and the classifiers", () => {
    const result = parseClassDiagram(
      `classDiagram
  class A {
    +String owner
    List~int~ position
    -count : int
    +String name$
    +run()*
    +go()$ int
    +calc(x) : float
  }
`,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const a = result.ir.classes[0]!;
    expect(a.attributes).toEqual([
      { name: "owner", visibility: "public", type: "String" },
      { name: "position", visibility: "public", type: "List~int~" },
      { name: "count", visibility: "private", type: "int" },
      // `$` is a classifier, not part of the type (the bug this fixes)
      { name: "name", visibility: "public", type: "String", static: true },
    ]);
    expect(a.methods).toEqual([
      { name: "run", visibility: "public", params: "", abstract: true },
      { name: "go", visibility: "public", params: "", type: "int", static: true },
      { name: "calc", visibility: "public", params: "x", type: "float" },
    ]);
    expectRoundTrip(result.ir);
  });

  it("parseMemberLine accepts the type-first and colon forms alike", () => {
    expect(parseMemberLine("+String name")).toEqual({ attribute: { name: "name", visibility: "public", type: "String" } });
    expect(parseMemberLine("+name : String")).toEqual({ attribute: { name: "name", visibility: "public", type: "String" } });
    expect(parseMemberLine("+run(a, b) Result")).toEqual({
      method: { name: "run", visibility: "public", params: "a, b", type: "Result" },
    });
    // a bare `Type name` pair is mermaid's type-first attribute, so only a
    // line with no member name at all is a parse failure
    expect(parseMemberLine("?? ??")).toBeNull();
  });
});

describe("annotations", () => {
  it("parses inline and block annotations, keeping every one", () => {
    const result = parseClassDiagram(
      `classDiagram
  class Shape <<interface>>
  class X <<interface>> {
    +run()
  }
  class Y {
    <<service>>
    <<bean>>
  }
`,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.ir.classes.map((c) => c.stereotypes)).toEqual([["interface"], ["interface"], ["service", "bean"]]);
    expectRoundTrip(result.ir);
  });
});

describe("notes", () => {
  it("parses free notes and notes for a class", () => {
    const result = parseClassDiagram(`classDiagram\n  class X\n  note "free note"\n  note for X "about X"\n`);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.ir.notes).toEqual([
      { id: "note-1", text: "free note" },
      { id: "note-2", text: "about X", target: "X" },
    ]);
    expectRoundTrip(result.ir);
  });

  it("round-trips multi-line note text", () => {
    const ir: ClassIR = {
      kind: "class",
      classes: [{ id: C("X"), name: "X", stereotypes: [], attributes: [], methods: [] }],
      relations: [],
      notes: [{ id: "note-1" as NoteId, text: 'one\ntwo "q"', target: C("X") }],
      namespaces: [],
    };
    expectRoundTrip(ir);
  });
});

describe("namespaces", () => {
  it("parses a flat namespace and keeps its members", () => {
    const code = `classDiagram
  namespace Shapes {
    class Square {
      +int id
    }
    class Circle
  }
  class Loose
  Square --> Circle
`;
    const result = parseClassDiagram(code);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.ir.namespaces).toEqual([{ id: "Shapes", name: "Shapes" }]);
    expect(result.ir.classes.map((c) => [c.name, c.namespace])).toEqual([
      ["Square", "Shapes"],
      ["Circle", "Shapes"],
      ["Loose", undefined],
    ]);
    expectRoundTrip(result.ir);
  });

  it("rejects nested namespaces", () => {
    const result = parseClassDiagram(`classDiagram\n  namespace A {\n    namespace B {\n      class X\n    }\n  }\n`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.message).toContain("nested namespaces");
  });
});

describe("parseClassDiagram dialect leniency", () => {
  it("accepts frontmatter, init directives, trailing `;`/`%%` comments, and drops cssClass/style/classDef/click", () => {
    const result = parseClassDiagram(`---
title: Classes
---
%%{init: {'theme':'dark'}}%%
classDiagram;
  class A:::hot {
    +run() %% comment
  }
  A --|> B; %% inherit
  A : +x : int;
  cssClass "A,B" hot
  classDef hot fill:#f00
  style A fill:#f9f
  click A href "https://x"
  accTitle: t
  accDescr { multi }
`);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.ir.classes.map((c) => c.name)).toEqual(["A", "B"]);
    expect(result.ir.classes[0]!.methods.map((m) => m.name)).toEqual(["run"]);
    expect(result.ir.classes[0]!.attributes.map((a) => [a.name, a.type])).toEqual([["x", "int"]]);
    expect(result.ir.relations.map((r) => r.headTo)).toEqual(["inheritance"]);
    expectRoundTrip(result.ir);
  });

  it("still treats `class` as a declaration (not dropped)", () => {
    const result = parseClassDiagram("classDiagram\n  class Foo\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.classes.map((c) => c.name)).toEqual(["Foo"]);
  });
});

describe("namespace ids stay branded", () => {
  it("assigns the namespace name as its id on import", () => {
    const result = parseClassDiagram(`classDiagram\n  namespace N {\n    class A\n  }\n`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.classes[0]!.namespace).toBe("N" as NamespaceId);
  });

  // A relation is the one place the emitter wrote free text raw: the label
  // and both cardinalities now travel as entities like every other label.
  it("relation labels and cardinalities survive the characters that would close their slot", () => {
    const ir: ClassIR = {
      kind: "class",
      classes: [
        { id: C("A"), name: "A", attributes: [], methods: [], stereotypes: [] },
        { id: C("B"), name: "B", attributes: [], methods: [], stereotypes: [] },
      ],
      relations: [
        {
          id: "relation-1" as RelationId,
          from: C("A"),
          to: C("B"),
          line: "solid",
          headFrom: "none",
          headTo: "arrow",
          label: 'says "hi" <now>',
          fromCardinality: '1.."n"',
          toCardinality: "0..*",
        },
      ],
      notes: [],
      namespaces: [],
    };
    expectRoundTrip(ir);
  });

  // `style Foo --> Bar` is thrown away whole as a styling statement, so a
  // class called `style` would lose every relation it starts.
  it("a class named after a dropped statement keyword keeps its relations", () => {
    const ir: ClassIR = {
      kind: "class",
      classes: [
        { id: C("style"), name: "style", attributes: [], methods: [], stereotypes: [] },
        { id: C("B"), name: "B", attributes: [], methods: [], stereotypes: [] },
      ],
      relations: [{ id: "relation-1" as RelationId, from: C("style"), to: C("B"), line: "solid", headFrom: "none", headTo: "arrow" }],
      notes: [],
      namespaces: [],
    };
    expectRoundTrip(ir);
  });
});
