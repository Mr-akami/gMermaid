import { describe, expect, it } from "vitest";
import type { EdgeId, FlowchartIR, NodeId } from "@gmermaid/ir";
import { flowchartToMermaid } from "./flowchart";

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
    { id: "edge-1" as EdgeId, from: "node-1" as NodeId, to: "node-2" as NodeId, arrow: "arrow" },
    { id: "edge-2" as EdgeId, from: "node-2" as NodeId, to: "node-3" as NodeId, arrow: "dotted", label: "yes" },
  ],
};

describe("flowchartToMermaid", () => {
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
