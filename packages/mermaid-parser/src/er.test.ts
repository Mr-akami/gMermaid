import { describe, expect, it } from "vitest";
import { erToMermaid } from "@gmermaid/mermaid-codegen";
import { parseErDiagram } from "./er";

const SAMPLE = `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE-ITEM : contains
    CUSTOMER }|..|{ DELIVERY-ADDRESS : uses
    CUSTOMER {
        string name
        string custNumber PK
        int parent_id PK, FK "refers up"
        string email UK "login, unique"
    }
`;

describe("parseErDiagram", () => {
  it("parses entities, attributes with keys and comments, and relationships", () => {
    const result = parseErDiagram(SAMPLE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.ir.entities.map((e) => e.name)).toEqual(["CUSTOMER", "ORDER", "LINE-ITEM", "DELIVERY-ADDRESS"]);
    const attrs = result.ir.entities[0]!.attributes.map(({ type, name, keys, comment }) => ({ type, name, keys, comment }));
    expect(attrs).toEqual([
      { type: "string", name: "name", keys: [], comment: undefined },
      { type: "string", name: "custNumber", keys: ["PK"], comment: undefined },
      { type: "int", name: "parent_id", keys: ["PK", "FK"], comment: "refers up" },
      { type: "string", name: "email", keys: ["UK"], comment: "login, unique" },
    ]);
    expect(result.ir.relationships.map(({ from, to, fromCard, toCard, identifying, label }) => ({ from, to, fromCard, toCard, identifying, label }))).toEqual([
      { from: "CUSTOMER", to: "ORDER", fromCard: "exactly-one", toCard: "zero-or-more", identifying: true, label: "places" },
      { from: "ORDER", to: "LINE-ITEM", fromCard: "exactly-one", toCard: "one-or-more", identifying: true, label: "contains" },
      { from: "CUSTOMER", to: "DELIVERY-ADDRESS", fromCard: "one-or-more", toCard: "one-or-more", identifying: false, label: "uses" },
    ]);
  });

  it("reads all four cardinalities on both sides", () => {
    const result = parseErDiagram(`erDiagram\n  A |o--o| B : a\n  A ||--|| B : b\n  A }o--o{ B : c\n  A }|--|{ B : d\n`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.relationships.map((r) => [r.fromCard, r.toCard])).toEqual([
      ["zero-or-one", "zero-or-one"],
      ["exactly-one", "exactly-one"],
      ["zero-or-more", "zero-or-more"],
      ["one-or-more", "one-or-more"],
    ]);
  });

  it("accepts direction, quoted names, aliases, a labelless relationship and self relationships", () => {
    const result = parseErDiagram(
      `erDiagram
  direction LR
  "my entity" ||--o{ P : "has many"
  P ||..o| P
  P["Pretty name"] {
    int id PK
  }
  Lonely
  Empty { }
`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.direction).toBe("LR");
    expect(result.ir.entities.map((e) => [e.name, e.alias])).toEqual([
      ["my entity", undefined],
      ["P", "Pretty name"],
      ["Lonely", undefined],
      ["Empty", undefined],
    ]);
    expect(result.ir.relationships[0]).toMatchObject({ label: "has many", identifying: true });
    expect(result.ir.relationships[1]).toMatchObject({ from: "P", to: "P", identifying: false });
    expect(result.ir.relationships[1]!.label).toBeUndefined();
    // a block can re-open an entity a relationship already created
    expect(result.ir.entities[1]!.attributes).toHaveLength(1);
  });

  it("drops styling with a warning instead of failing", () => {
    const result = parseErDiagram(
      `erDiagram
  A:::hot ||--o{ B : x
  classDef hot fill:#f00
  style A fill:#ff0
  class B hot
  click A "https://example.com"
  accTitle: a title
`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.entities.map((e) => e.name)).toEqual(["A", "B"]);
    const said = result.warnings.map((w) => w.message).join("\n");
    for (const kw of ["classDef", "style", "class", "click", "accTitle"]) expect(said).toContain(`\`${kw}\``);
    expect(result.warnings.length).toBeGreaterThanOrEqual(6); // + the `:::hot` suffix
  });

  it("reports bad headers, bad attributes, bad lines and unclosed blocks", () => {
    expect(parseErDiagram("flowchart TD\n").ok).toBe(false);
    const bad = parseErDiagram(`erDiagram\n  A {\n    justonetoken\n  }\n  A =>> B\n`);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.map((e) => e.message)).toEqual([
      expect.stringContaining("cannot parse attribute"),
      expect.stringContaining("cannot parse:"),
    ]);
    const unclosed = parseErDiagram(`erDiagram\n  A {\n    int id\n`);
    expect(unclosed.ok).toBe(false);
    if (unclosed.ok) return;
    expect(unclosed.errors[0]!.message).toContain("unclosed entity block");
  });

  it("round trips: parse(codegen(parse(x))) is stable and keeps the IR", () => {
    const first = parseErDiagram(SAMPLE);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const text = erToMermaid(first.ir);
    const second = parseErDiagram(text);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.ir).toEqual(first.ir);
    expect(erToMermaid(second.ir)).toBe(text);
  });

  it("round trips names and text that need quoting or escaping", () => {
    const first = parseErDiagram(
      `erDiagram
  "a b" ||--o{ "class" : "has #quot;x#quot; #35;1"
  "a b" {
    int id "say #lt;hi#gt;"
  }
`,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.ir.relationships[0]!.label).toBe('has "x" #1');
    expect(first.ir.entities[0]!.attributes[0]!.comment).toBe("say <hi>");
    const second = parseErDiagram(erToMermaid(first.ir));
    expect(second.ok && second.ir).toEqual(first.ir);
  });
});
