import { describe, expect, it } from "vitest";
import { FLOWCHART_SHAPES, normalizeFlowchartEdge, type EdgeId, type FlowchartIR, type NodeId } from "@gmermaid/ir";
import { edgeToken, flowchartToMermaid } from "@gmermaid/mermaid-codegen";
import { parseFlowchart } from "./flowchart";

const sortById = <T extends { id: string }>(xs: readonly T[]) => [...xs].toSorted((a, b) => a.id.localeCompare(b.id));

describe("parseFlowchart", () => {
  it("parses the subset codegen emits", () => {
    const result = parseFlowchart(
      `flowchart LR
  a("Start")
  b{"Is valid?"}
  c["End"]
  a --> b
  b -.->|"yes"| c
  b ==>|no| a
`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.direction).toBe("LR");
    expect(result.ir.nodes.map((n) => [n.id, n.label, n.shape])).toEqual([
      ["a", "Start", "rounded"],
      ["b", "Is valid?", "diamond"],
      ["c", "End", "rect"],
    ]);
    expect(result.ir.edges.map((e) => [e.from, e.to, e.line, e.headEnd, e.label])).toEqual([
      ["a", "b", "solid", "arrow", undefined],
      ["b", "c", "dotted", "arrow", "yes"],
      ["b", "a", "thick", "arrow", "no"],
    ]);
  });

  it("accepts hand-written variants (graph TD, bare ids, inline decls)", () => {
    const result = parseFlowchart(`graph TD\n  A --> B["hello world"]\n  C\n`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.direction).toBe("TB");
    expect(result.ir.nodes.map((n) => n.id)).toEqual(["A", "B", "C"]);
    expect(result.ir.nodes[0]!.label).toBe("A");
  });

  it("reports errors with line numbers and keeps going", () => {
    const result = parseFlowchart(`flowchart TB\n  a --> b\n  ???\n  a --> a\n`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      { line: 3, message: expect.stringContaining("cannot parse") },
      { line: 4, message: expect.stringContaining("self-loop") },
    ]);
  });

  it("rejects a missing header", () => {
    const result = parseFlowchart("a --> b\n");
    expect(result.ok).toBe(false);
  });

  it("round-trips: parse(gen(ir)) == ir, and gen is stable across the loop", () => {
    const ir: FlowchartIR = {
      kind: "flowchart",
  subgraphs: [],
      direction: "LR",
      nodes: [
        { id: "n1" as NodeId, label: 'say "hi" #1', shape: "stadium" },
        { id: "n2" as NodeId, label: "multi\nline", shape: "circle" },
        { id: "n3" as NodeId, label: "plain", shape: "diamond" },
      ],
      edges: [
        { id: "edge-1" as EdgeId, from: "n1" as NodeId, to: "n2" as NodeId, line: "dotted", headStart: "none", headEnd: "arrow", label: "a#b" },
        { id: "edge-2" as EdgeId, from: "n2" as NodeId, to: "n3" as NodeId, line: "solid", headStart: "none", headEnd: "none" },
      ],
    };
    const code = flowchartToMermaid(ir);
    const back = parseFlowchart(code);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.ir).toEqual(ir);
    expect(flowchartToMermaid(back.ir)).toBe(code);
  });

  it("round-trips every extended node shape and the invisible link", () => {
    const shapes = [
      "subroutine",
      "cylinder",
      "hexagon",
      "asymmetric",
      "doubleCircle",
      "parallelogram",
      "parallelogramAlt",
      "trapezoid",
      "trapezoidAlt",
    ] as const;
    const ir: FlowchartIR = {
      kind: "flowchart",
  subgraphs: [],
      direction: "TB",
      nodes: shapes.map((shape, i) => ({ id: `n${i}` as NodeId, label: `s ${shape}`, shape })),
      edges: [{ id: "edge-1" as EdgeId, from: "n0" as NodeId, to: "n1" as NodeId, line: "invisible", headStart: "none", headEnd: "none" }],
    };
    const code = flowchartToMermaid(ir);
    const back = parseFlowchart(code);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.ir).toEqual(ir);
  });

  it("parses chained edges and `&` fan-out", () => {
    const result = parseFlowchart("flowchart TB\n  a --> b --> c\n  a & b --> d\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.edges.map((e) => [e.from, e.to])).toEqual([
      ["a", "b"],
      ["b", "c"],
      ["a", "d"],
      ["b", "d"],
    ]);
  });

  it("parses `A-- text -->B` inline edge labels", () => {
    const result = parseFlowchart("flowchart TB\n  a-- go -->b\n  b-. maybe .->c\n  c== hard ==>d\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.edges.map((e) => [e.label, e.line, e.headEnd])).toEqual([
      ["go", "solid", "arrow"],
      ["maybe", "dotted", "arrow"],
      ["hard", "thick", "arrow"],
    ]);
  });

  it("parses nested subgraphs with titles, direction and edges to a subgraph", () => {
    const code = `flowchart TB
  subgraph s1["Group 1"]
    direction LR
    a["A"] --> b["B"]
    subgraph s2["Inner"]
      c["C"]
    end
  end
  d["D"] --> s1
  b --> d
`;
    const result = parseFlowchart(code);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.subgraphs).toEqual([
      { id: "s1", label: "Group 1", direction: "LR" },
      { id: "s2", label: "Inner", parent: "s1" },
    ]);
    expect(result.ir.nodes.map((n) => [n.id, n.parent])).toEqual([
      ["a", "s1"],
      ["b", "s1"],
      ["c", "s2"],
      ["d", undefined],
    ]);
    expect(result.ir.edges.map((e) => [e.from, e.to])).toEqual([
      ["a", "b"],
      ["d", "s1"], // edge to the subgraph as a whole
      ["b", "d"],
    ]);
    // round trip: blocks regroup members, so node ORDER may shift once —
    // content must survive, and the text form must be a fixpoint after that
    const regen = flowchartToMermaid(result.ir);
    const back = parseFlowchart(regen);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(sortById(back.ir.nodes)).toEqual(sortById(result.ir.nodes));
    expect(back.ir.edges).toEqual(result.ir.edges);
    expect(back.ir.subgraphs).toEqual(result.ir.subgraphs);
    expect(flowchartToMermaid(back.ir)).toBe(regen);
  });

  it("resolves an edge endpoint declared as a subgraph only later", () => {
    const result = parseFlowchart("flowchart TB\n  a --> grp\n  subgraph grp[G]\n    b\n  end\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(result.ir.edges[0]).toMatchObject({ from: "a", to: "grp" });
  });

  it("does not split `&` inside a bracketed label", () => {
    const result = parseFlowchart('flowchart TB\n  a["x & y"] --> b\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.nodes[0]!.label).toBe("x & y");
    expect(result.ir.edges).toHaveLength(1);
  });
});

const roundTripLenient = (code: string) => {
  const result = parseFlowchart(code);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  const regen = flowchartToMermaid(result.ir);
  const back = parseFlowchart(regen);
  expect(back.ok, regen).toBe(true);
  if (!back.ok) throw new Error("unreachable");
  expect(back.ir).toEqual(result.ir);
  return result.ir;
};

describe("parseFlowchart dialect leniency", () => {
  it("accepts frontmatter and init directives before the header", () => {
    const ir = roundTripLenient(`---
title: Flow
---
%%{init: {'theme':'dark'}}%%
flowchart LR
  A --> B
`);
    expect(ir.edges.map((e) => [e.from, e.to])).toEqual([["A", "B"]]);
  });

  it("accepts a bare `flowchart` header (= TB) and `graph TD;`", () => {
    expect(roundTripLenient("flowchart\n  A --> B").direction).toBe("TB");
    expect(roundTripLenient("graph TD;\n  A-->B").direction).toBe("TB");
    expect(roundTripLenient("graph LR ;\n  A-->B").direction).toBe("LR");
  });

  it("splits `;`-separated statements and drops trailing `%%` comments", () => {
    const ir = roundTripLenient(`graph TD;
  A-->B; B-->C; %% chain
  C["x; y"] --> D;
`);
    expect(ir.edges.map((e) => `${e.from}>${e.to}`)).toEqual(["A>B", "B>C", "C>D"]);
    expect(ir.nodes.find((n) => n.id === "C")!.label).toBe("x; y");
  });

  it("drops style / classDef / class / linkStyle / click / accTitle / accDescr and `:::class`", () => {
    const ir = roundTripLenient(`flowchart LR
  accTitle: Access title
  accDescr {
    multi line
    description
  }
  A:::hot --> B["Bee"]:::cold
  style A fill:#f9f,stroke:#333
  classDef hot fill:#f00
  class B cold
  linkStyle 0 stroke:red
  click A callback "tip"
`);
    expect(ir.nodes.map((n) => [n.id, n.label])).toEqual([
      ["A", "A"],
      ["B", "Bee"],
    ]);
    expect(ir.edges).toHaveLength(1);
  });

  it("accepts non-ASCII ids and `.` inside ids", () => {
    const ir = roundTripLenient(`flowchart LR
  日本["日本語"] --> ユーザ
  a.b --> svc.api
  subgraph 領域["x"]
    ユーザ --> a.b
  end
`);
    expect(ir.nodes.map((n) => n.id)).toEqual(["日本", "ユーザ", "a.b", "svc.api"]);
    expect(ir.subgraphs.map((s) => s.id)).toEqual(["領域"]);
  });

  it("keeps original line numbers in errors after preamble", () => {
    const result = parseFlowchart("---\nt: x\n---\nflowchart LR\n  A --> B\n  ???\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.line).toBe(6);
  });
});

// Link tokens, as mermaid's own destructLink reads them (probed against
// mermaid.js 11.16.1): the last char is the head, the rest is the line, and
// the leftover line chars are the rank span.
const link = (code: string) => {
  const result = parseFlowchart(`flowchart TB\n  ${code}\n`);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  const e = result.ir.edges[0]!;
  return [e.line, e.headStart, e.headEnd, e.length ?? 1, e.label] as const;
};

describe("parseFlowchart edge model", () => {
  it.each([
    ["A --> B", ["solid", "none", "arrow", 1, undefined]],
    ["A --- B", ["solid", "none", "none", 1, undefined]],
    ["A -.-> B", ["dotted", "none", "arrow", 1, undefined]],
    ["A -.- B", ["dotted", "none", "none", 1, undefined]],
    ["A ==> B", ["thick", "none", "arrow", 1, undefined]],
    ["A === B", ["thick", "none", "none", 1, undefined]],
    ["A ~~~ B", ["invisible", "none", "none", 1, undefined]],
    ["A <--> B", ["solid", "arrow", "arrow", 1, undefined]],
    ["A <==> B", ["thick", "arrow", "arrow", 1, undefined]],
    ["A <-.-> B", ["dotted", "arrow", "arrow", 1, undefined]],
    ["A --o B", ["solid", "none", "circle", 1, undefined]],
    ["A --x B", ["solid", "none", "cross", 1, undefined]],
    ["A o--o B", ["solid", "circle", "circle", 1, undefined]],
    ["A x--x B", ["solid", "cross", "cross", 1, undefined]],
    ["A o-- txt --o B", ["solid", "circle", "circle", 1, "txt"]],
    ["A x== txt ==x B", ["thick", "cross", "cross", 1, "txt"]],
    ["A -- txt --> B", ["solid", "none", "arrow", 1, "txt"]],
    ["A -. txt .-> B", ["dotted", "none", "arrow", 1, "txt"]],
    ["A == txt ==> B", ["thick", "none", "arrow", 1, "txt"]],
    ["A -->|txt| B", ["solid", "none", "arrow", 1, "txt"]],
    ["A ---> B", ["solid", "none", "arrow", 2, undefined]],
    ["A ----> B", ["solid", "none", "arrow", 3, undefined]],
    ["A ---- B", ["solid", "none", "none", 2, undefined]],
    ["A -..-> B", ["dotted", "none", "arrow", 2, undefined]],
    ["A -...-> B", ["dotted", "none", "arrow", 3, undefined]],
    ["A ====> B", ["thick", "none", "arrow", 3, undefined]],
    ["A ~~~~ B", ["invisible", "none", "none", 2, undefined]],
    ["A -- txt ----> B", ["solid", "none", "arrow", 3, "txt"]],
  ])("reads %s", (code, expected) => {
    expect(link(code)).toEqual(expected);
  });

  it("parses `A--txt-->B` as an edge, not as a node called `A--txt`", () => {
    const result = parseFlowchart("flowchart TB\n  A--txt-->B\n  C==hard==>D\n  E-.soft.->F\n");
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.ir.nodes.map((n) => n.id)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(result.ir.edges.map((e) => [e.from, e.to, e.line, e.label])).toEqual([
      ["A", "B", "solid", "txt"],
      ["C", "D", "thick", "hard"],
      ["E", "F", "dotted", "soft"],
    ]);
  });

  it("keeps a leading `o`/`x` glued to an id inside the id (`Ao--oB`)", () => {
    const result = parseFlowchart("flowchart TB\n  Ao--oB\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.nodes.map((n) => n.id)).toEqual(["Ao", "B"]);
    expect(result.ir.edges[0]).toMatchObject({ headStart: "none", headEnd: "circle" });
  });

  it("round-trips every line style, head pair and length", () => {
    const ir = roundTripLenient(`flowchart TB
  a["A"] <--> b["B"]
  a o--o b
  a x--x b
  a --o b
  a --x b
  a ---- b
  a -..-> b
  a ====> b
  a ~~~~ b
  a -- one ---> b
`);
    // codegen is canonical: node decls on their own lines, labels in |"…"|
    expect(flowchartToMermaid(ir)).toBe(`flowchart TB
  a["A"]
  b["B"]
  a <--> b
  a o--o b
  a x--x b
  a --o b
  a --x b
  a ---- b
  a -..-> b
  a ====> b
  a ~~~~ b
  a --->|"one"| b
`);
  });
});

describe("parseFlowchart `@{ … }` shapes", () => {
  it("parses shape + label and maps aliases", () => {
    const result = parseFlowchart(`flowchart TB
  A@{ shape: doc, label: "Report" }
  B@{ shape: document }
  C@{ shape: manual-input, label: "Type it" }
  D@{ shape: rounded, label: "Round" }
  A --> B --> C --> D
`);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.ir.nodes.map((n) => [n.id, n.shape, n.label])).toEqual([
      ["A", "doc", "Report"],
      ["B", "doc", "B"],
      ["C", "slRect", "Type it"],
      ["D", "rounded", "Round"],
    ]);
  });

  it("emits the bracket form when there is one, `@{}` otherwise", () => {
    const result = parseFlowchart('flowchart TB\n  A@{ shape: rounded, label: "R" } --> B@{ shape: hourglass, label: "H" }\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const code = flowchartToMermaid(result.ir);
    expect(code).toContain('A("R")');
    expect(code).toContain('B@{ shape: hourglass, label: "H" }');
    const back = parseFlowchart(code);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.ir).toEqual(result.ir);
  });

  it("round-trips every shape in the registry", () => {
    const ir: FlowchartIR = {
      kind: "flowchart",
      subgraphs: [],
      direction: "TB",
      nodes: FLOWCHART_SHAPES.map((s, i) => ({ id: `n${i}` as NodeId, label: `s ${s.shape}`, shape: s.shape })),
      edges: [],
    };
    const code = flowchartToMermaid(ir);
    const back = parseFlowchart(code);
    expect(back.ok, code).toBe(true);
    if (!back.ok) return;
    expect(back.ir).toEqual(ir);
  });

  it("reports an unknown shape", () => {
    const result = parseFlowchart("flowchart TB\n  A@{ shape: banana }\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.message).toContain("unknown shape");
  });
});

describe("parseFlowchart id-less subgraphs", () => {
  it("synthesizes an id and keeps the title", () => {
    const result = parseFlowchart(`flowchart TB
  subgraph My Title
    direction LR
    a --> b
  end
  subgraph "Second one"
    c
  end
`);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.ir.subgraphs).toEqual([
      { id: "subGraph0", label: "My Title", direction: "LR" },
      { id: "subGraph1", label: "Second one" },
    ]);
    // the synthesized id is mermaid-safe, so the emitted text round trips
    const code = flowchartToMermaid(result.ir);
    expect(code).toContain('subgraph subGraph0["My Title"]');
    const back = parseFlowchart(code);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.ir.subgraphs).toEqual(result.ir.subgraphs);
  });
});

// The sweep that found the gap, kept as a guard: the IR's edge model and
// mermaid's link tokens must have exactly the same reach. Every NORMALIZED
// edge has to survive emit → parse; anything else would let the canvas and
// the saved text disagree.
describe("every normalized edge survives the round trip", () => {
  const lines = ["solid", "dotted", "thick", "invisible"] as const;
  const heads = ["none", "arrow", "circle", "cross"] as const;
  const labels = [undefined, "go"] as const;
  const cases = lines.flatMap((line) =>
    heads.flatMap((headStart) =>
      heads.flatMap((headEnd) =>
        [1, 2, 3].flatMap((length) =>
          labels.map((label) => ({
            edge: normalizeFlowchartEdge({
              id: "edge-1" as EdgeId,
              from: "a" as NodeId,
              to: "b" as NodeId,
              line,
              headStart,
              headEnd,
              ...(length > 1 ? { length } : {}),
              ...(label !== undefined ? { label } : {}),
            }),
            name: `${line}/${headStart}/${headEnd}/${length}/${label ?? "nolabel"}`,
          })),
        ),
      ),
    ),
  );

  it.each(cases)("$name", ({ edge }) => {
    const ir: FlowchartIR = {
      kind: "flowchart",
      direction: "TB",
      nodes: [
        { id: "a" as NodeId, label: "a", shape: "rect" },
        { id: "b" as NodeId, label: "b", shape: "rect" },
      ],
      edges: [edge],
      subgraphs: [],
    };
    const result = parseFlowchart(flowchartToMermaid(ir));
    expect(result.ok, `${edgeToken(edge)}: ${JSON.stringify(result)}`).toBe(true);
    if (!result.ok) return;
    expect(result.ir.edges[0], edgeToken(edge)).toEqual(edge);
  });
});

describe("ids saved under the old keyword-prefixed scheme", () => {
  const old = `flowchart TB
  subgraph subgraph-a6bde494["Group 1"]
    node-1b2c3d4e["Inside"]
  end
  subgraph subgraph-ffffffff["Group 2"]
  end
  node-e455cb6b --> subgraph-a6bde494
  subgraph-a6bde494 --> subgraph-ffffffff
`;

  it("renames them and takes every reference along", () => {
    const result = parseFlowchart(old);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.subgraphs.map((s) => s.id)).toEqual(["grp_a6bde494", "grp_ffffffff"]);
    expect(result.ir.subgraphs.map((s) => s.label)).toEqual(["Group 1", "Group 2"]);
    expect(result.ir.nodes.find((n) => n.id === "node-1b2c3d4e")?.parent).toBe("grp_a6bde494");
    expect(result.ir.edges.map((e) => [e.from, e.to])).toEqual([
      ["node-e455cb6b", "grp_a6bde494"],
      ["grp_a6bde494", "grp_ffffffff"],
    ]);
  });

  it("says so once per renamed id, at its first line", () => {
    const result = parseFlowchart(old);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([
      { line: 2, message: "`subgraph-a6bde494` starts with a mermaid keyword, so it was renamed to `grp_a6bde494`" },
      { line: 5, message: "`subgraph-ffffffff` starts with a mermaid keyword, so it was renamed to `grp_ffffffff`" },
    ]);
  });

  it("round trips once repaired", () => {
    const first = parseFlowchart(old);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = parseFlowchart(flowchartToMermaid(first.ir));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    // codegen writes top-level nodes before the blocks, so the declaration
    // ORDER of this hand-written file does not survive — the ids do
    expect(sortById(again.ir.nodes)).toEqual(sortById(first.ir.nodes));
    expect(sortById(again.ir.subgraphs)).toEqual(sortById(first.ir.subgraphs));
    // nothing left to repair the second time around
    expect(again.warnings).toEqual([]);
  });
});
