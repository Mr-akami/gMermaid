import { describe, expect, it } from "vitest";
import type { ElementId, RelationId, RequirementId, RequirementIR } from "@gmermaid/ir";
import { fixedWidthMeasurer } from "./measurer";
import { layoutRequirementDiagram } from "./requirement";

const Q = (s: string) => s as RequirementId;
const E = (s: string) => s as ElementId;
const R = (s: string) => s as RelationId;

const ir: RequirementIR = {
  kind: "requirement",
  requirements: [
    {
      id: Q("test_req"),
      name: "test_req",
      type: "functionalRequirement",
      reqId: "1.1",
      text: "the test text.",
      risk: "High",
      verifyMethod: "Test",
    },
  ],
  elements: [{ id: E("test_entity"), name: "test_entity", type: "simulation", docRef: "reqs/test_entity" }],
  relations: [{ id: R("r1"), from: E("test_entity"), to: Q("test_req"), type: "satisfies" }],
};

describe("layoutRequirementDiagram", () => {
  it("matches the committed golden layout", () => {
    expect(layoutRequirementDiagram(ir, fixedWidthMeasurer())).toMatchSnapshot();
  });

  it("renders a type header, the fields and an edge label per relation", () => {
    const result = layoutRequirementDiagram(ir, fixedWidthMeasurer());
    const req = result.boxes.find((b) => b.id === "test_req")!;
    expect(req.stereotype).toBe("«functionalRequirement»");
    expect(req.lines).toEqual(["Id: 1.1", "Text: the test text.", "Risk: High", "Verify: Test"]);
    const elem = result.boxes.find((b) => b.id === "test_entity")!;
    expect(elem.stereotype).toBe("«element»");
    expect(elem.lines).toEqual(["Type: simulation", "Doc Ref: reqs/test_entity"]);
    expect(result.edges[0]!.label).toBe("«satisfies»");
    // the header separator stays inside the box
    for (const b of result.boxes) {
      expect(b.headerBottom).toBeGreaterThan(b.rect.y);
      expect(b.headerBottom).toBeLessThan(b.rect.y + b.rect.h);
    }
  });

  it("wraps long requirement text instead of stretching the box", () => {
    const long = "word ".repeat(30).trim();
    const result = layoutRequirementDiagram(
      { ...ir, requirements: [{ id: Q("test_req"), name: "test_req", type: "requirement", text: long }], elements: [], relations: [] },
      fixedWidthMeasurer(),
    );
    const lines = result.boxes[0]!.lines;
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(34);
  });

  it("routes self-relations as a rectangular detour off the right side", () => {
    const selfIr: RequirementIR = {
      ...ir,
      relations: [
        { id: R("r1"), from: Q("test_req"), to: Q("test_req"), type: "traces" },
        { id: R("r2"), from: Q("test_req"), to: Q("test_req"), type: "refines" },
      ],
    };
    const result = layoutRequirementDiagram(selfIr, fixedWidthMeasurer());
    const box = result.boxes.find((b) => b.id === "test_req")!;
    const right = box.rect.x + box.rect.w;
    const [e1, e2] = result.edges;
    for (const e of [e1!, e2!]) {
      expect(e.points).toHaveLength(4);
      expect(e.points[0]!.x).toBe(right);
      expect(e.points[3]!.x).toBe(right);
      expect(e.points[1]!.x).toBeGreaterThan(right);
    }
    expect(e2!.points[1]!.x).toBeGreaterThan(e1!.points[1]!.x);
    expect(result.size.w).toBeGreaterThanOrEqual(e2!.points[1]!.x);
  });

  it("returns finite sizes for an empty diagram", () => {
    const result = layoutRequirementDiagram(
      { kind: "requirement", requirements: [], elements: [], relations: [] },
      fixedWidthMeasurer(),
    );
    expect(Number.isFinite(result.size.w)).toBe(true);
    expect(Number.isFinite(result.size.h)).toBe(true);
    expect(result.size.w).toBeGreaterThan(0);
  });

  it("returns pure JSON data (ADR 0001 guard)", () => {
    const result = layoutRequirementDiagram(ir, fixedWidthMeasurer());
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
