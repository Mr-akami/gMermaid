import { describe, expect, it } from "vitest";
import type { AttributeId, EntityId, ErIR, RelationId } from "@gmermaid/ir";
import { layoutEr } from "./er";
import { fixedWidthMeasurer } from "./measurer";

const E = (s: string) => s as EntityId;
const A = (s: string) => s as AttributeId;
const R = (s: string) => s as RelationId;

const ir: ErIR = {
  kind: "er",
  entities: [
    {
      id: E("c"),
      name: "CUSTOMER",
      attributes: [
        { id: A("a1"), type: "int", name: "id", keys: ["PK"] },
        { id: A("a2"), type: "string", name: "email", keys: ["UK", "FK"], comment: "login" },
      ],
    },
    { id: E("o"), name: "ORDER", alias: "Customer order", attributes: [] },
  ],
  relationships: [
    { id: R("r1"), from: E("c"), to: E("o"), fromCard: "exactly-one", toCard: "zero-or-more", identifying: true, label: "places" },
  ],
};

describe("layoutEr", () => {
  it("draws the alias as the title, one row per attribute, and keeps rows inside the box", () => {
    const result = layoutEr(ir, fixedWidthMeasurer());
    const customer = result.boxes.find((b) => b.id === "c")!;
    expect(customer.title).toBe("CUSTOMER");
    expect(result.boxes.find((b) => b.id === "o")!.title).toBe("Customer order");
    expect(customer.rows.map((r) => [r.type, r.name, r.keys, r.comment])).toEqual([
      ["int", "id", "PK", ""],
      ["string", "email", "UK, FK", "login"],
    ]);
    expect(customer.headerBottom).toBeGreaterThan(customer.rect.y);
    for (const row of customer.rows) {
      expect(row.y).toBeGreaterThan(customer.headerBottom);
      expect(row.y).toBeLessThan(customer.rect.y + customer.rect.h);
    }
    // columns run left to right inside the box
    const cols = customer.columns;
    expect([...cols].toSorted((a, b) => a - b)).toEqual([...cols]);
    expect(cols[0]).toBeGreaterThanOrEqual(customer.rect.x);
  });

  it("places entities apart and runs the edge from one to the other", () => {
    const result = layoutEr(ir, fixedWidthMeasurer());
    const [a, b] = result.boxes;
    const overlap = a!.rect.x < b!.rect.x + b!.rect.w && b!.rect.x < a!.rect.x + a!.rect.w && a!.rect.y < b!.rect.y + b!.rect.h && b!.rect.y < a!.rect.y + a!.rect.h;
    expect(overlap).toBe(false);
    const edge = result.edges[0]!;
    expect(edge).toMatchObject({ fromCard: "exactly-one", toCard: "zero-or-more", identifying: true, label: "places" });
    expect(edge.points.length).toBeGreaterThanOrEqual(2);
  });

  it("honours the direction", () => {
    const lr = layoutEr({ ...ir, direction: "LR" }, fixedWidthMeasurer());
    const [a, b] = lr.boxes;
    expect(b!.rect.x).toBeGreaterThan(a!.rect.x + a!.rect.w);
  });

  it("routes self relationships as a detour off the right side", () => {
    const self: ErIR = {
      ...ir,
      relationships: [
        { id: R("s1"), from: E("c"), to: E("c"), fromCard: "zero-or-one", toCard: "zero-or-more", identifying: false, label: "refers" },
        { id: R("s2"), from: E("c"), to: E("c"), fromCard: "zero-or-one", toCard: "zero-or-more", identifying: false },
      ],
    };
    const result = layoutEr(self, fixedWidthMeasurer());
    const box = result.boxes.find((b) => b.id === "c")!;
    const right = box.rect.x + box.rect.w;
    const [e1, e2] = result.edges;
    for (const e of [e1!, e2!]) {
      expect(e.points).toHaveLength(4);
      expect(e.points[0]!.x).toBe(right);
      expect(e.points[1]!.x).toBeGreaterThan(right);
    }
    expect(e2!.points[1]!.x).toBeGreaterThan(e1!.points[1]!.x);
    expect(result.size.w).toBeGreaterThanOrEqual(e2!.points[1]!.x);
  });

  it("returns finite sizes for an empty diagram", () => {
    const result = layoutEr({ kind: "er", entities: [], relationships: [] }, fixedWidthMeasurer());
    expect(Number.isFinite(result.size.w)).toBe(true);
    expect(Number.isFinite(result.size.h)).toBe(true);
  });

  it("returns pure JSON data (ADR 0001 guard)", () => {
    const result = layoutEr(ir, fixedWidthMeasurer());
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
