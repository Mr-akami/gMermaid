import { describe, expect, it } from "vitest";
import type { EdgeId, FlowchartIR, NodeId } from "@gmermaid/ir";
import { flowchartToMermaid } from "./flowchart";

function one(label: string): FlowchartIR {
  return {
    kind: "flowchart",
  subgraphs: [],
    direction: "TB",
    nodes: [{ id: "node-1" as NodeId, label, shape: "rect" }],
    edges: [],
  };
}

describe("label escaping", () => {
  it("escapes # before introducing entities (round-trip safety)", () => {
    expect(flowchartToMermaid(one("#quot;"))).toContain('node-1["#35;quot;"]');
  });

  it("escapes double quotes", () => {
    expect(flowchartToMermaid(one('say "hi"'))).toContain('node-1["say #quot;hi#quot;"]');
  });

  it("converts newlines to <br/>", () => {
    expect(flowchartToMermaid(one("line1\nline2"))).toContain('node-1["line1<br/>line2"]');
    expect(flowchartToMermaid(one("a\r\nb"))).toContain('node-1["a<br/>b"]');
  });

  it("escapes < and > before emitting <br/> (HTML label safety)", () => {
    expect(flowchartToMermaid(one("a<b>c"))).toContain('node-1["a#lt;b#gt;c"]');
    expect(flowchartToMermaid(one("x<y\nz"))).toContain('node-1["x#lt;y<br/>z"]');
  });

  it("handles empty labels", () => {
    expect(flowchartToMermaid(one(""))).toContain('node-1[""]');
  });

  it("emits all shapes and arrows", () => {
    const ir: FlowchartIR = {
      kind: "flowchart",
  subgraphs: [],
      direction: "LR",
      nodes: (["rect", "rounded", "stadium", "diamond", "circle"] as const).map((shape, i) => ({
        id: `node-${i}` as NodeId,
        label: shape,
        shape,
      })),
      edges: (["arrow", "open", "dotted", "thick"] as const).map((arrow, i) => ({
        id: `edge-${i}` as EdgeId,
        from: `node-${i}` as NodeId,
        to: `node-${i + 1}` as NodeId,
        arrow,
      })),
    };
    expect(flowchartToMermaid(ir)).toMatchSnapshot();
  });
});
