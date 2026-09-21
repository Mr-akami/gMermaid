import { describe, expect, it } from "vitest";
import { edgePath } from "./edgePath";

describe("edgePath", () => {
  it("draws a straight line between two points", () => {
    expect(edgePath([{ x: 0, y: 0 }, { x: 10, y: 20 }])).toBe("M 0 0 L 10 20");
  });

  it("starts and ends on the polyline", () => {
    const d = edgePath([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 40 }]);
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d.endsWith("50 40")).toBe(true);
  });

  it("rounds the corner instead of drawing it", () => {
    // the middle point is approximated, so the path must not pass through it
    const d = edgePath([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 40 }]);
    expect(d).toContain("C");
    expect(d).not.toContain("L 50 0");
  });

  it("ignores repeated points", () => {
    expect(edgePath([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }])).toBe("M 0 0 L 10 0");
  });

  it("survives empty and single-point input", () => {
    expect(edgePath([])).toBe("");
    expect(edgePath([{ x: 3, y: 4 }])).toBe("M 3 4");
  });
});
