import { describe, expect, it } from "vitest";
import type { MindmapIR, MindmapNodeId } from "@gmermaid/ir";
import { fixedWidthMeasurer } from "./measurer";
import { layoutMindmap } from "./mindmap";

const M = (s: string) => s as MindmapNodeId;

const ir: MindmapIR = {
  kind: "mindmap",
  nodes: [
    { id: M("root"), label: "mindmap", shape: "circle" },
    { id: M("origins"), label: "Origins", shape: "default", parent: M("root") },
    { id: M("history"), label: "Long history", shape: "square", parent: M("origins") },
    { id: M("pop"), label: "Popularisation", shape: "default", parent: M("origins") },
    { id: M("research"), label: "Research", shape: "default", parent: M("root") },
    { id: M("tools"), label: "Tools", shape: "cloud", parent: M("root") },
  ],
};

const box = (result: { nodes: readonly { id: string; rect: { x: number; y: number; w: number; h: number } }[] }, id: string) =>
  result.nodes.find((n) => n.id === id)!;

describe("layoutMindmap", () => {
  it("matches the committed golden layout", () => {
    expect(layoutMindmap(ir, fixedWidthMeasurer())).toMatchSnapshot();
  });

  it("alternates the root's children right, left, right and pushes depth outwards", () => {
    const result = layoutMindmap(ir, fixedWidthMeasurer());
    const root = box(result, "root");
    expect(result.nodes.map((n) => n.side)).toEqual(["root", "right", "right", "right", "left", "right"]);
    // right-hand children start after the root, left-hand ones before it
    expect(box(result, "origins").rect.x).toBeGreaterThan(root.rect.x + root.rect.w);
    expect(box(result, "research").rect.x + box(result, "research").rect.w).toBeLessThan(root.rect.x);
    // a grandchild sits further out than its parent, on the same side
    expect(box(result, "history").rect.x).toBeGreaterThan(box(result, "origins").rect.x);
  });

  it("stacks siblings without overlap and centres a parent on its children", () => {
    const result = layoutMindmap(ir, fixedWidthMeasurer());
    const history = box(result, "history");
    const pop = box(result, "pop");
    expect(pop.rect.y).toBeGreaterThanOrEqual(history.rect.y + history.rect.h);
    const parent = box(result, "origins");
    const childSpan = (history.rect.y + history.rect.h / 2 + pop.rect.y + pop.rect.h / 2) / 2;
    expect(parent.rect.y + parent.rect.h / 2).toBeCloseTo(childSpan);
  });

  it("draws one cubic branch per non-root node, leaving the parent's near side", () => {
    const result = layoutMindmap(ir, fixedWidthMeasurer());
    expect(result.branches).toHaveLength(5);
    for (const b of result.branches) expect(b.points).toHaveLength(4);
    const toOrigins = result.branches.find((b) => b.to === "origins")!;
    const root = box(result, "root");
    expect(toOrigins.points[0]!.x).toBeCloseTo(root.rect.x + root.rect.w);
    expect(toOrigins.points[3]!.x).toBeCloseTo(box(result, "origins").rect.x);
    // a left-hand child is approached from its right edge instead
    const toResearch = result.branches.find((b) => b.to === "research")!;
    expect(toResearch.points[0]!.x).toBeCloseTo(root.rect.x);
    expect(toResearch.points[3]!.x).toBeCloseTo(box(result, "research").rect.x + box(result, "research").rect.w);
  });

  it("keeps every box inside the reported size, from non-negative coordinates", () => {
    const result = layoutMindmap(ir, fixedWidthMeasurer());
    for (const n of result.nodes) {
      expect(n.rect.x).toBeGreaterThanOrEqual(0);
      expect(n.rect.y).toBeGreaterThanOrEqual(0);
      expect(n.rect.x + n.rect.w).toBeLessThanOrEqual(result.size.w + 0.001);
      expect(n.rect.y + n.rect.h).toBeLessThanOrEqual(result.size.h + 0.001);
    }
  });

  it("returns finite sizes for an empty mindmap and pure JSON data", () => {
    const empty = layoutMindmap({ kind: "mindmap", nodes: [] }, fixedWidthMeasurer());
    expect(Number.isFinite(empty.size.w)).toBe(true);
    expect(empty.nodes).toEqual([]);
    const result = layoutMindmap(ir, fixedWidthMeasurer());
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
