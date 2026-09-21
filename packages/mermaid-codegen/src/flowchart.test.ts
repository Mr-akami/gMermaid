import { describe, expect, it } from "vitest";
import type { EdgeId, FlowchartEdge, FlowchartIR, NodeId } from "@gmermaid/ir";
import { edgeToken, flowchartToMermaid } from "./flowchart";

const ir: FlowchartIR = {
  kind: "flowchart",
  subgraphs: [],
  direction: "TB",
  nodes: [
    { id: "node-1" as NodeId, label: "Start", shape: "rounded" },
    { id: "node-2" as NodeId, label: "Is valid?", shape: "diamond" },
    { id: "node-3" as NodeId, label: "End", shape: "rect" },
  ],
  edges: [
    { id: "edge-1" as EdgeId, from: "node-1" as NodeId, to: "node-2" as NodeId, line: "solid", headStart: "none", headEnd: "arrow" },
    { id: "edge-2" as EdgeId, from: "node-2" as NodeId, to: "node-3" as NodeId, line: "dotted", headStart: "none", headEnd: "arrow", label: "yes" },
  ],
};

const token = (e: Partial<FlowchartEdge>) =>
  edgeToken({ id: "e" as EdgeId, from: "a" as NodeId, to: "b" as NodeId, line: "solid", headStart: "none", headEnd: "arrow", ...e });

describe("edgeToken", () => {
  it("emits the canonical mermaid token per line style and head pair", () => {
    expect(token({})).toBe("-->");
    expect(token({ headEnd: "none" })).toBe("---");
    expect(token({ headEnd: "circle" })).toBe("--o");
    expect(token({ headEnd: "cross" })).toBe("--x");
    expect(token({ headStart: "arrow", headEnd: "arrow" })).toBe("<-->");
    expect(token({ headStart: "circle", headEnd: "circle" })).toBe("o--o");
    expect(token({ headStart: "cross", headEnd: "cross" })).toBe("x--x");
    expect(token({ line: "dotted" })).toBe("-.->");
    expect(token({ line: "dotted", headEnd: "none" })).toBe("-.-");
    expect(token({ line: "dotted", headStart: "arrow" })).toBe("<-.->");
    expect(token({ line: "thick" })).toBe("==>");
    expect(token({ line: "thick", headEnd: "none" })).toBe("===");
    expect(token({ line: "thick", headStart: "arrow" })).toBe("<==>");
    expect(token({ line: "invisible", headEnd: "none" })).toBe("~~~");
  });

  it("repeats line characters for length", () => {
    expect(token({ length: 2 })).toBe("--->");
    expect(token({ length: 3 })).toBe("---->");
    expect(token({ headEnd: "none", length: 2 })).toBe("----");
    expect(token({ line: "dotted", length: 3 })).toBe("-...->");
    expect(token({ line: "thick", length: 3 })).toBe("====>");
    expect(token({ line: "invisible", headEnd: "none", length: 2 })).toBe("~~~~");
  });

  it("drops a start head mermaid cannot express (asymmetric pair)", () => {
    expect(token({ headStart: "circle", headEnd: "arrow" })).toBe("-->");
  });
});

describe("flowchartToMermaid", () => {
  it("emits `@{ shape: … }` only for shapes without a bracket form", () => {
    const shaped: FlowchartIR = {
      ...ir,
      nodes: [
        { id: "n1" as NodeId, label: "Doc", shape: "doc" },
        { id: "n2" as NodeId, label: "Round", shape: "rounded" },
      ],
      edges: [],
    };
    expect(flowchartToMermaid(shaped)).toBe(
      `flowchart TB\n  n1@{ shape: doc, label: "Doc" }\n  n2("Round")\n`,
    );
  });

  it("emits mermaid flowchart syntax", () => {
    expect(flowchartToMermaid(ir)).toBe(
      `flowchart TB
  node-1("Start")
  node-2{"Is valid?"}
  node-3["End"]
  node-1 --> node-2
  node-2 -.->|"yes"| node-3
`,
    );
  });
});
