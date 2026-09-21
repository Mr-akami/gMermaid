import { describe, expect, it } from "vitest";
import type { MindmapNodeId } from "./ids";
import { mindmapChildren, mindmapDepth, mindmapRoot, type MindmapIR } from "./mindmap";
import { mindmapLabelRejection, sanitizeMindmapLabel } from "./mindmap";
import { applyMindmapAction, mindmapMoveRejection } from "./mindmapActions";

const M = (s: string) => s as MindmapNodeId;

const base: MindmapIR = {
  kind: "mindmap",
  nodes: [
    { id: M("root"), label: "Root", shape: "circle" },
    { id: M("a"), label: "A", shape: "default", parent: M("root") },
    { id: M("a1"), label: "A1", shape: "square", parent: M("a") },
    { id: M("b"), label: "B", shape: "default", parent: M("root") },
  ],
};

describe("applyMindmapAction", () => {
  it("adds a child last among its siblings, or directly behind `after`", () => {
    const appended = applyMindmapAction(base, {
      type: "addNode",
      node: { id: M("c"), label: "C", shape: "default", parent: M("root") },
    });
    expect(mindmapChildren(appended, M("root")).map((n) => n.id)).toEqual(["a", "b", "c"]);

    const inserted = applyMindmapAction(base, {
      type: "addNode",
      node: { id: M("c"), label: "C", shape: "default", parent: M("root") },
      after: M("a"),
    });
    expect(mindmapChildren(inserted, M("root")).map((n) => n.id)).toEqual(["a", "c", "b"]);
  });

  it("refuses a second root, a duplicate id and an unknown parent", () => {
    expect(applyMindmapAction(base, { type: "addNode", node: { id: M("x"), label: "X", shape: "default" } })).toBe(base);
    expect(
      applyMindmapAction(base, { type: "addNode", node: { id: M("a"), label: "A", shape: "default", parent: M("root") } }),
    ).toBe(base);
    expect(
      applyMindmapAction(base, { type: "addNode", node: { id: M("x"), label: "X", shape: "default", parent: M("zz") } }),
    ).toBe(base);
    // the first node of an empty mindmap IS the root
    const seeded = applyMindmapAction({ kind: "mindmap", nodes: [] }, {
      type: "addNode",
      node: { id: M("r"), label: "R", shape: "circle" },
    });
    expect(mindmapRoot(seeded)?.id).toBe("r");
  });

  it("removeNode takes the whole subtree with it", () => {
    const next = applyMindmapAction(base, { type: "removeNode", id: M("a") });
    expect(next.nodes.map((n) => n.id)).toEqual(["root", "b"]);
    expect(applyMindmapAction(base, { type: "removeNode", id: M("zz") })).toBe(base);
  });

  it("updateNode clears an emptied icon and keeps identity on a no-op", () => {
    const withIcon = applyMindmapAction(base, { type: "updateNode", id: M("a"), icon: "fa fa-book" });
    expect(withIcon.nodes[1]!.icon).toBe("fa fa-book");
    const cleared = applyMindmapAction(withIcon, { type: "updateNode", id: M("a"), icon: "" });
    expect("icon" in cleared.nodes[1]!).toBe(false);
    expect(applyMindmapAction(base, { type: "updateNode", id: M("a"), label: "A", shape: "default" })).toBe(base);
  });

  it("moveNode re-parents a subtree but refuses cycles and the root", () => {
    expect(mindmapMoveRejection(base, M("root"), M("a"))).toBe("the root cannot be moved");
    expect(mindmapMoveRejection(base, M("a"), M("a1"))).toBe("cannot move a node into its own subtree");
    expect(mindmapMoveRejection(base, M("a"), M("a"))).toBe("cannot move a node into itself");
    expect(mindmapMoveRejection(base, M("a"), M("b"))).toBeUndefined();

    const moved = applyMindmapAction(base, { type: "moveNode", id: M("a"), parent: M("b") });
    expect(mindmapChildren(moved, M("b")).map((n) => n.id)).toEqual(["a"]);
    // the subtree follows its root
    expect(mindmapDepth(moved, M("a1"))).toBe(3);
    expect(applyMindmapAction(base, { type: "moveNode", id: M("a"), parent: M("a1") })).toBe(base);
  });

  it("reorderNode swaps with a sibling and stops at the ends", () => {
    const down = applyMindmapAction(base, { type: "reorderNode", id: M("a"), delta: 1 });
    expect(mindmapChildren(down, M("root")).map((n) => n.id)).toEqual(["b", "a"]);
    // the moved node keeps its own children
    expect(mindmapChildren(down, M("a")).map((n) => n.id)).toEqual(["a1"]);
    expect(applyMindmapAction(base, { type: "reorderNode", id: M("a"), delta: -1 })).toBe(base);
    expect(applyMindmapAction(base, { type: "reorderNode", id: M("root"), delta: 1 })).toBe(base);
  });

  // the outline line carries the tree, so the label may not fake indentation,
  // a class suffix, a comment or a statement terminator
  it("strips what a label cannot hold, and refuses one that leaves the line blank", () => {
    expect(sanitizeMindmapLabel("  a:::b %% c;  ")).toBe("ab  c");
    const next = applyMindmapAction(base, { type: "updateNode", id: M("a"), label: "  leading" });
    expect(next.nodes.find((n) => n.id === "a")!.label).toBe("leading");
    for (const bad of ["", "   ", ":::", "%%"]) {
      expect(mindmapLabelRejection(bad), bad).toBeDefined();
      expect(applyMindmapAction(base, { type: "updateNode", id: M("a"), label: bad }), bad).toBe(base);
    }
  });
});
