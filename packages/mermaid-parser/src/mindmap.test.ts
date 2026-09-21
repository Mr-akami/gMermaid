import { describe, expect, it } from "vitest";
import { mindmapToMermaid } from "@gmermaid/mermaid-codegen";
import { applyMindmapAction, emptyMindmap, type MindmapIR, type MindmapNodeId } from "@gmermaid/ir";
import { parseMindmap } from "./mindmap";

/** parse → codegen → parse must land on the same IR, and the text form must
 * then be a fixpoint. */
function expectRoundTrip(code: string) {
  const first = parseMindmap(code);
  expect(first.ok).toBe(true);
  if (!first.ok) throw new Error("unparseable");
  const regen = mindmapToMermaid(first.ir);
  const back = parseMindmap(regen);
  expect(back.ok).toBe(true);
  if (!back.ok) throw new Error("regenerated code does not parse");
  expect(back.ir).toEqual(first.ir);
  expect(mindmapToMermaid(back.ir)).toBe(regen);
  return first.ir;
}

describe("parseMindmap", () => {
  it("reads the docs sample: hierarchy from indentation, shapes and icons", () => {
    const code = `mindmap
  root((mindmap))
    Origins
      Long history
      ::icon(fa fa-book)
      Popularisation
        British popular psychology author Tony Buzan
    Research
      On effectiveness<br/>and features
    Tools
      Pen and paper
`;
    const ir = expectRoundTrip(code);
    expect(ir.nodes.map((n) => [n.id, n.label, n.shape, n.parent])).toEqual([
      ["root", "mindmap", "circle", undefined],
      ["mindmap-1", "Origins", "default", "root"],
      ["mindmap-2", "Long history", "default", "mindmap-1"],
      ["mindmap-3", "Popularisation", "default", "mindmap-1"],
      ["mindmap-4", "British popular psychology author Tony Buzan", "default", "mindmap-3"],
      ["mindmap-5", "Research", "default", "root"],
      ["mindmap-6", "On effectiveness\nand features", "default", "mindmap-5"],
      ["mindmap-7", "Tools", "default", "root"],
      ["mindmap-8", "Pen and paper", "default", "mindmap-7"],
    ]);
    // the icon line decorates the node written above it
    expect(ir.nodes.find((n) => n.label === "Long history")?.icon).toBe("fa fa-book");
  });

  it("reads every node shape", () => {
    const code = `mindmap
  r((root))
    a[square]
    b(rounded)
    c((circle))
    d))bang((
    e)cloud(
    f{{hexagon}}
    plain text
`;
    const ir = expectRoundTrip(code);
    expect(ir.nodes.map((n) => n.shape)).toEqual([
      "circle",
      "square",
      "rounded",
      "circle",
      "bang",
      "cloud",
      "hexagon",
      "default",
    ]);
  });

  it("follows mermaid's rule for unclear indentation (nearest smaller indent)", () => {
    // from the docs: C is neither a child of B nor a sibling of A — the
    // nearest previous node with a smaller indentation is A
    const code = `mindmap
    Root
        A
            B
          C
`;
    const result = parseMindmap(code);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byLabel = new Map(result.ir.nodes.map((n) => [n.label, n]));
    expect(byLabel.get("B")!.parent).toBe(byLabel.get("A")!.id);
    expect(byLabel.get("C")!.parent).toBe(byLabel.get("A")!.id);
  });

  it("keeps `:::class` (own line and inline) and skips `%%` comments", () => {
    const code = `mindmap
  %% a comment
  Root
    A[A]
    :::urgent large
    B(B):::calm
`;
    const result = parseMindmap(code);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.nodes.map((n) => n.classes)).toEqual([undefined, ["urgent", "large"], ["calm"]]);
    // the inline form is only tolerated on import: codegen writes both as lines
    expect(mindmapToMermaid(result.ir)).toContain("  :::urgent large");
  });

  it("round trips labels carrying brackets, quotes and entities", () => {
    const code = `mindmap
  r(("Root #35; one"))
    a["f(x) [y] {z}"]
    b(("say #quot;hi#quot;"))
    plain #40;paren#41; text
`;
    const ir = expectRoundTrip(code);
    expect(ir.nodes.map((n) => n.label)).toEqual([
      "Root # one",
      "f(x) [y] {z}",
      'say "hi"',
      "plain (paren) text",
    ]);
  });

  it("tolerates frontmatter, a directive and an empty diagram", () => {
    const code = `---
title: t
---
%%{init: {"theme":"dark"}}%%
mindmap
  root
`;
    const ir = expectRoundTrip(code);
    expect(ir.nodes).toHaveLength(1);
    const empty = parseMindmap("mindmap\n");
    expect(empty.ok && empty.ir.nodes).toEqual([]);
  });

  it("refuses a second root and a missing header", () => {
    const two = parseMindmap("mindmap\n  a\n  b\n");
    expect(two.ok).toBe(false);
    if (two.ok) return;
    expect(two.errors[0]!.message).toMatch(/only one root/);
    expect(parseMindmap("flowchart LR\n").ok).toBe(false);
  });

  it("never mints an id that the document uses further down", () => {
    const code = `mindmap
  root
    bare one
    mindmap-1[explicit]
`;
    const ir = expectRoundTrip(code);
    expect(ir.nodes.map((n) => n.id)).toEqual(["mindmap-2", "mindmap-3", "mindmap-1"]);
  });

  // The outline form gives the LINE its meaning, so a label may not fake one:
  // leading space is indentation, `:::` is a class, `%%` is a comment and a
  // trailing `;` is a terminator. The reducer strips them at the boundary.
  it("hostile labels the reducer accepts survive emit → parse", () => {
    let ir: MindmapIR = emptyMindmap();
    ir = applyMindmapAction(ir, { type: "addNode", node: { id: "root" as MindmapNodeId, label: "Root", shape: "circle" } });
    ir = applyMindmapAction(ir, {
      type: "addNode",
      node: { id: "mindmap-1" as MindmapNodeId, label: "  a:::b %% c;", shape: "default", parent: "root" as MindmapNodeId },
    });
    ir = applyMindmapAction(ir, {
      type: "addNode",
      node: { id: "mindmap-2" as MindmapNodeId, label: "child", shape: "default", parent: "mindmap-1" as MindmapNodeId },
    });
    expect(ir.nodes[1]!.label).toBe("ab  c");
    const back = parseMindmap(mindmapToMermaid(ir));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    // the child must still hang off the middle node, not off the root
    expect(back.ir.nodes.map((n) => [n.label, n.parent])).toEqual(ir.nodes.map((n) => [n.label, n.parent]));
  });

  it("refuses a label that would leave nothing but indentation on the line", () => {
    let ir: MindmapIR = emptyMindmap();
    ir = applyMindmapAction(ir, { type: "addNode", node: { id: "root" as MindmapNodeId, label: "Root", shape: "circle" } });
    const before = ir;
    // the node would vanish on re-import and its children would climb a level
    expect(applyMindmapAction(ir, { type: "updateNode", id: "root" as MindmapNodeId, label: "  " })).toBe(before);
    expect(
      applyMindmapAction(ir, { type: "addNode", node: { id: "x" as MindmapNodeId, label: ":::", shape: "default", parent: "root" as MindmapNodeId } }),
    ).toBe(before);
  });

  it("drops a styling statement instead of reading it as a second root", () => {
    const result = parseMindmap("mindmap\n  root((r))\n    a\nclassDef x fill:#f00\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.nodes.map((n) => n.label)).toEqual(["r", "a"]);
    expect(result.warnings).toEqual([
      { line: 4, message: "`classDef` is not represented in the editor and will be lost on save" },
    ]);
  });

  it("keeps node labels that merely start with a dropped keyword", () => {
    // mindmap text is free prose and has no `class` statement at all, so
    // these are nodes, not styling
    const result = parseMindmap("mindmap\n  root((r))\n    style guide\n    class diagram\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.nodes.map((n) => n.label)).toEqual(["r", "style guide", "class diagram"]);
    expect(result.warnings).toEqual([]);
  });
});
