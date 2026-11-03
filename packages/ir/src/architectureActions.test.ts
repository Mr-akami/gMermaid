import { describe, expect, it } from "vitest";
import type { ArchEdgeId, ArchGroupId, ArchJunctionId, ArchServiceId } from "./ids";
import { archGroupsParentFirst, emptyArchitectureDiagram, type ArchitectureIR } from "./architecture";
import { applyArchitectureAction, archEdgeRetargetRejection, archNameRejection } from "./architectureActions";

const G = (s: string) => s as ArchGroupId;
const S = (s: string) => s as ArchServiceId;
const J = (s: string) => s as ArchJunctionId;
const E = (s: string) => s as ArchEdgeId;

function base(): ArchitectureIR {
  let ir = emptyArchitectureDiagram();
  ir = applyArchitectureAction(ir, { type: "addGroup", group: { id: G("g1"), name: "g1", label: "G1" } });
  ir = applyArchitectureAction(ir, { type: "addGroup", group: { id: G("g2"), name: "g2", parent: G("g1") } });
  ir = applyArchitectureAction(ir, { type: "addService", service: { id: S("a"), name: "a", group: G("g1") } });
  ir = applyArchitectureAction(ir, { type: "addService", service: { id: S("b"), name: "b", group: G("g2") } });
  ir = applyArchitectureAction(ir, { type: "addService", service: { id: S("c"), name: "c" } });
  ir = applyArchitectureAction(ir, { type: "addJunction", junction: { id: J("j"), name: "j" } });
  return ir;
}

const edge = (id: string, from: string, to: string, extra = {}) => ({
  id: E(id),
  from: S(from),
  to: S(to),
  fromSide: "R" as const,
  toSide: "L" as const,
  arrowFrom: false,
  arrowTo: true,
  ...extra,
});

describe("archNameRejection", () => {
  it("accepts mermaid-safe names and names the keyword it refuses", () => {
    expect(archNameRejection("my-svc_2")).toBeUndefined();
    expect(archNameRejection("has space")).toMatch(/letters/);
    expect(archNameRejection("group")).toMatch(/keyword/);
    expect(archNameRejection("R")).toMatch(/keyword/);
    expect(archNameRejection("-x")).toMatch(/letters/);
  });
});

describe("applyArchitectureAction", () => {
  it("rejects duplicate names across groups, services and junctions", () => {
    const ir = base();
    expect(applyArchitectureAction(ir, { type: "addService", service: { id: S("x"), name: "g1" } })).toBe(ir);
    expect(applyArchitectureAction(ir, { type: "addJunction", junction: { id: J("y"), name: "a" } })).toBe(ir);
    expect(applyArchitectureAction(ir, { type: "addGroup", group: { id: G("z"), name: "j" } })).toBe(ir);
    expect(applyArchitectureAction(ir, { type: "rename", id: S("a"), name: "j" })).toBe(ir);
    expect(applyArchitectureAction(ir, { type: "addService", service: { id: S("q"), name: "q", group: G("nope") } })).toBe(ir);
  });

  it("renames without touching the id", () => {
    const next = applyArchitectureAction(base(), { type: "rename", id: S("a"), name: "api" });
    expect(next.services[0]).toMatchObject({ id: "a", name: "api" });
  });

  it("sets label and icon, clearing with an empty string", () => {
    let ir = applyArchitectureAction(base(), { type: "updateService", id: S("a"), label: "  API  ", icon: "server" });
    expect(ir.services[0]).toMatchObject({ label: "API", icon: "server" });
    ir = applyArchitectureAction(ir, { type: "updateService", id: S("a"), label: "", icon: "" });
    expect(ir.services[0]!.label).toBeUndefined();
    expect(ir.services[0]!.icon).toBeUndefined();
    expect(applyArchitectureAction(ir, { type: "updateService", id: S("a"), icon: "bad icon" })).toBe(ir);
    expect(applyArchitectureAction(ir, { type: "updateService", id: S("a"), label: "" })).toBe(ir);
  });

  it("removes a node with its edges, and a group by promoting its members", () => {
    let ir = base();
    ir = applyArchitectureAction(ir, { type: "addEdge", edge: edge("e1", "a", "b") });
    ir = applyArchitectureAction(ir, { type: "addEdge", edge: edge("e2", "b", "c") });
    const gone = applyArchitectureAction(ir, { type: "removeNode", id: S("b") });
    expect(gone.edges).toEqual([]);

    const flat = applyArchitectureAction(ir, { type: "removeGroup", id: G("g1") });
    expect(flat.groups.map((g) => [g.id, g.parent])).toEqual([["g2", undefined]]);
    expect(flat.services.find((s) => s.id === "a")!.group).toBeUndefined();
    expect(flat.services.find((s) => s.id === "b")!.group).toBe("g2");
    const mid = applyArchitectureAction(ir, { type: "removeGroup", id: G("g2") });
    expect(mid.services.find((s) => s.id === "b")!.group).toBe("g1");
  });

  it("refuses a group inside itself or its own descendant", () => {
    const ir = base();
    expect(applyArchitectureAction(ir, { type: "setGroupParent", id: G("g1"), parent: G("g1") })).toBe(ir);
    expect(applyArchitectureAction(ir, { type: "setGroupParent", id: G("g1"), parent: G("g2") })).toBe(ir);
    const out = applyArchitectureAction(ir, { type: "setGroupParent", id: G("g2"), parent: null });
    expect(out.groups.find((g) => g.id === "g2")!.parent).toBeUndefined();
  });

  it("lists parents before children even when stored the other way round", () => {
    const ir = base();
    const swapped = { ...ir, groups: [ir.groups[1]!, ir.groups[0]!] };
    expect(archGroupsParentFirst(swapped).map((g) => g.id)).toEqual(["g1", "g2"]);
  });

  it("adds edges between nodes only, never a self edge or one to a group", () => {
    const ir = base();
    expect(applyArchitectureAction(ir, { type: "addEdge", edge: edge("e", "a", "a") })).toBe(ir);
    expect(applyArchitectureAction(ir, { type: "addEdge", edge: { ...edge("e", "a", "b"), to: G("g1") as never } })).toBe(ir);
    const two = applyArchitectureAction(ir, { type: "addEdge", edge: edge("e", "a", "j") });
    expect(two.edges).toHaveLength(1);
    expect(applyArchitectureAction(two, { type: "addEdge", edge: edge("e", "a", "c") })).toBe(two);
  });

  it("keeps `{group}` flags valid as membership changes", () => {
    let ir = applyArchitectureAction(base(), { type: "addEdge", edge: edge("e", "a", "c", { groupFrom: true }) });
    expect(ir.edges[0]!.groupFrom).toBe(true);
    // c joins a's group: the edge no longer crosses a border
    ir = applyArchitectureAction(ir, { type: "setNodeGroup", id: S("c"), group: G("g1") });
    expect(ir.edges[0]!.groupFrom).toBeUndefined();
    // and a flag on a node with no group is dropped at once
    const flat = applyArchitectureAction(ir, { type: "updateEdge", id: E("e"), groupTo: true });
    expect(flat.edges[0]!.groupTo).toBeUndefined();
  });

  it("updates sides, arrows and label; a no-op returns the same object", () => {
    let ir = applyArchitectureAction(base(), { type: "addEdge", edge: edge("e", "a", "c") });
    ir = applyArchitectureAction(ir, { type: "updateEdge", id: E("e"), fromSide: "B", toSide: "T", arrowFrom: true, label: " reads " });
    expect(ir.edges[0]).toMatchObject({ fromSide: "B", toSide: "T", arrowFrom: true, arrowTo: true, label: "reads" });
    expect(applyArchitectureAction(ir, { type: "updateEdge", id: E("e"), fromSide: "B" })).toBe(ir);
    ir = applyArchitectureAction(ir, { type: "updateEdge", id: E("e"), label: "" });
    expect(ir.edges[0]!.label).toBeUndefined();
  });

  it("retargets one end and says why a retarget is refused", () => {
    let ir = applyArchitectureAction(base(), { type: "addEdge", edge: edge("e", "a", "c") });
    ir = applyArchitectureAction(ir, { type: "retargetEdge", id: E("e"), to: J("j") });
    expect(ir.edges[0]!.to).toBe("j");
    expect(archEdgeRetargetRejection(ir, E("e"), { to: S("a") })).toMatch(/itself/);
    expect(archEdgeRetargetRejection(ir, E("e"), { to: G("g1") as never })).toMatch(/group/);
    expect(archEdgeRetargetRejection(ir, E("e"), { from: S("zz") })).toMatch(/unknown/);
    expect(applyArchitectureAction(ir, { type: "retargetEdge", id: E("e"), to: S("a") })).toBe(ir);
  });
});
