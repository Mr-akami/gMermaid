import { describe, expect, it } from "vitest";
import type { ArchEdgeId, ArchGroupId, ArchJunctionId, ArchServiceId, ArchSide, ArchitectureIR } from "@gmermaid/ir";
import { archCellOffset, archRoute, layoutArchitecture, type ArchitectureLayout } from "./architecture";
import { fixedWidthMeasurer } from "./measurer";
import { rectsOverlap } from "./collision";

const G = (s: string) => s as ArchGroupId;
const S = (s: string) => s as ArchServiceId;
const J = (s: string) => s as ArchJunctionId;
const E = (s: string) => s as ArchEdgeId;

const edge = (id: string, from: string, fromSide: ArchSide, toSide: ArchSide, to: string, extra = {}) => ({
  id: E(id),
  from: S(from),
  to: S(to),
  fromSide,
  toSide,
  arrowFrom: false,
  arrowTo: false,
  ...extra,
});

const ir: ArchitectureIR = {
  kind: "architecture",
  groups: [
    { id: G("api"), name: "api", label: "API", icon: "cloud" },
    { id: G("inner"), name: "inner", label: "Inner", parent: G("api") },
  ],
  services: [
    { id: S("db"), name: "db", label: "Database", icon: "database", group: G("api") },
    { id: S("server"), name: "server", label: "Server", icon: "server", group: G("inner") },
    { id: S("disk"), name: "disk", label: "Storage", icon: "disk", group: G("api") },
    { id: S("gw"), name: "gw", label: "Gateway", icon: "internet" },
  ],
  junctions: [{ id: J("fork"), name: "fork" }],
  edges: [
    edge("e1", "db", "L", "R", "server"),
    edge("e2", "disk", "T", "B", "db"),
    edge("e3", "server", "T", "B", "fork"),
    { ...edge("e4", "fork", "R", "L", "gw"), to: S("gw"), from: J("fork"), arrowTo: true, label: "reads" },
  ],
};

const measure = fixedWidthMeasurer(8);
const centre = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

type R = { x: number; y: number; w: number; h: number };
const inside = (a: R, b: R) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

function boxes(l: ArchitectureLayout) {
  const rects = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const s of l.services) rects.set(s.id, s.rect);
  for (const j of l.junctions) rects.set(j.id, j.rect);
  return rects;
}

describe("archCellOffset", () => {
  it("puts the target on the side the source port faces", () => {
    expect(archCellOffset("R", "L")).toEqual({ x: 1, y: 0 });
    expect(archCellOffset("L", "R")).toEqual({ x: -1, y: 0 });
    expect(archCellOffset("B", "T")).toEqual({ x: 0, y: 1 });
    expect(archCellOffset("T", "B")).toEqual({ x: 0, y: -1 });
    // a bend: leave right, arrive from above → one right, one down
    expect(archCellOffset("R", "T")).toEqual({ x: 1, y: 1 });
    expect(archCellOffset("B", "L")).toEqual({ x: 1, y: 1 });
  });
});

describe("layoutArchitecture", () => {
  it("matches the committed golden layout", () => {
    expect(layoutArchitecture(ir, measure)).toMatchSnapshot();
  });

  it("survives a JSON round trip (pure data)", () => {
    const l = layoutArchitecture(ir, measure);
    expect(JSON.parse(JSON.stringify(l))).toEqual(l);
  });

  it("honours port sides: the neighbour lies on the side an edge leaves from", () => {
    const rects = boxes(layoutArchitecture(ir, measure));
    const at = (id: string) => centre(rects.get(id)!);
    // db:L -- R:server  → server is left of db
    expect(at("server").x).toBeLessThan(at("db").x);
    // disk:T -- B:db → db is above disk
    expect(at("db").y).toBeLessThan(at("disk").y);
    // server:T -- B:fork → fork is above server
    expect(at("fork").y).toBeLessThan(at("server").y);
    // fork:R -- L:gw → gw is right of fork
    expect(at("gw").x).toBeGreaterThan(at("fork").x);
  });

  it("keeps members inside their frames, frames inside their parents, and nothing overlapping", () => {
    const l = layoutArchitecture(ir, measure);
    const frame = (id: string) => l.groups.find((g) => g.id === id)!.rect;
    const rects = boxes(l);
    expect(inside(rects.get("server")!, frame("inner"))).toBe(true);
    expect(inside(frame("inner"), frame("api"))).toBe(true);
    expect(inside(rects.get("db")!, frame("api"))).toBe(true);
    expect(inside(rects.get("disk")!, frame("api"))).toBe(true);
    // a service outside a group is outside its frame
    expect(rectsOverlap(rects.get("gw")!, frame("api"))).toBe(false);
    // the group title sits above the topmost member
    expect(Math.min(...[...rects].filter(([id]) => id !== "gw" && id !== "fork").map(([, r]) => r.y))).toBeGreaterThan(frame("api").y + 20);

    const all = [...rects.entries()];
    for (let i = 0; i < all.length; i++) {
      for (let k = i + 1; k < all.length; k++) {
        expect(rectsOverlap(all[i]![1], all[k]![1]), `${all[i]![0]} vs ${all[k]![0]}`).toBe(false);
      }
    }
  });

  it("draws an edge straight when both ports face each other on one line", () => {
    const l = layoutArchitecture(
      { kind: "architecture", groups: [], services: [{ id: S("a"), name: "a" }, { id: S("b"), name: "b" }], junctions: [], edges: [edge("e", "a", "R", "L", "b")] },
      measure,
    );
    const pts = l.edges[0]!.points;
    expect(pts).toHaveLength(2);
    expect(pts[0]!.y).toBe(pts[1]!.y);
    expect(pts[1]!.x).toBeGreaterThan(pts[0]!.x);
  });

  it("ends a `{group}` edge on the border of the node's group", () => {
    const withFlag: ArchitectureIR = {
      ...ir,
      edges: [{ ...edge("g", "db", "R", "L", "gw"), groupFrom: true }],
    };
    const l = layoutArchitecture(withFlag, measure);
    const frame = l.groups.find((g) => g.id === "api")!.rect;
    expect(l.edges[0]!.points[0]!.x).toBe(frame.x + frame.w);
  });

  it("places unconnected services in a packed grid, not one long strip", () => {
    const many: ArchitectureIR = {
      kind: "architecture",
      groups: [],
      services: Array.from({ length: 12 }, (_, i) => ({ id: S(`s${i}`), name: `s${i}` })),
      junctions: [],
      edges: [],
    };
    const l = layoutArchitecture(many, measure);
    expect(new Set(l.services.map((s) => s.rect.y)).size).toBeGreaterThan(1);
  });

  it("does not stack services when constraints collide", () => {
    // both edges ask for the cell right of `a`
    const crowded: ArchitectureIR = {
      kind: "architecture",
      groups: [],
      services: ["a", "b", "c"].map((n) => ({ id: S(n), name: n })),
      junctions: [],
      edges: [edge("e1", "a", "R", "L", "b"), edge("e2", "a", "R", "L", "c")],
    };
    const l = layoutArchitecture(crowded, measure);
    const rs = l.services.map((s) => s.rect);
    for (let i = 0; i < rs.length; i++) for (let k = i + 1; k < rs.length; k++) expect(rectsOverlap(rs[i]!, rs[k]!)).toBe(false);
  });

  it("lays out an empty diagram and an empty group", () => {
    expect(Number.isFinite(layoutArchitecture({ kind: "architecture", groups: [], services: [], junctions: [], edges: [] }, measure).size.w)).toBe(true);
    const l = layoutArchitecture({ kind: "architecture", groups: [{ id: G("g"), name: "g" }], services: [], junctions: [], edges: [] }, measure);
    expect(l.groups[0]!.rect.w).toBeGreaterThan(0);
  });

  it("terminates on a group cycle in hand-built IR", () => {
    const cyc: ArchitectureIR = {
      kind: "architecture",
      groups: [
        { id: G("a"), name: "a", parent: G("b") },
        { id: G("b"), name: "b", parent: G("a") },
      ],
      services: [{ id: S("s"), name: "s", group: G("a") }],
      junctions: [],
      edges: [],
    };
    expect(() => layoutArchitecture(cyc, measure)).not.toThrow();
  });
});

describe("archRoute", () => {
  it("leaves along the port side and uses right-angle bends only", () => {
    const pts = archRoute({ x: 0, y: 0 }, "R", { x: 200, y: 120 }, "T");
    expect(pts).toEqual([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 120 }]);
    const back = archRoute({ x: 200, y: 0 }, "R", { x: 0, y: 0 }, "L");
    for (let i = 0; i + 1 < back.length; i++) {
      expect(back[i]!.x === back[i + 1]!.x || back[i]!.y === back[i + 1]!.y).toBe(true);
    }
    expect(back[1]!.x).toBeGreaterThan(200);
    // one row: it swings below the nodes instead of running through them
    expect(Math.max(...back.map((p) => p.y))).toBeGreaterThan(0);
  });
});
