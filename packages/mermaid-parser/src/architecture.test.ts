import { describe, expect, it } from "vitest";
import { architectureToMermaid } from "@gmermaid/mermaid-codegen";
import { parseArchitecture } from "./architecture";

const ok = (code: string) => {
  const r = parseArchitecture(code);
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.line}: ${e.message}`).join("\n"));
  return r;
};
const errors = (code: string) => {
  const r = parseArchitecture(code);
  return r.ok ? [] : r.errors.map((e) => e.message);
};

describe("parseArchitecture", () => {
  it("parses the docs' opening example", () => {
    const { ir } = ok(`architecture-beta
    group api(cloud)[API]

    service db(database)[Database] in api
    service disk1(disk)[Storage] in api
    service disk2(disk)[Storage] in api
    service server(server)[Server] in api

    db:L -- R:server
    disk1:T -- B:server
    disk2:T -- B:db
`);
    expect(ir.groups).toEqual([{ id: "api", name: "api", label: "API", icon: "cloud" }]);
    expect(ir.services.map((s) => [s.name, s.label, s.icon, s.group])).toEqual([
      ["db", "Database", "database", "api"],
      ["disk1", "Storage", "disk", "api"],
      ["disk2", "Storage", "disk", "api"],
      ["server", "Server", "server", "api"],
    ]);
    expect(ir.edges[0]).toEqual({ id: "edge-1", from: "db", to: "server", fromSide: "L", toSide: "R", arrowFrom: false, arrowTo: false });
    expect(ir.edges[2]).toMatchObject({ from: "disk2", fromSide: "T", to: "db", toSide: "B" });
  });

  it("reads arrows, edge titles, junctions and nested groups", () => {
    const { ir } = ok(`architecture-beta
  group a(cloud)[A]
  group b[B] in a
  service x(server)[X] in b
  service y[Y]
  junction j in a
  x:R <--> L:y
  x:B -["says \\"hi\\""]-> T:j
  y:T <-- B:j
`);
    expect(ir.groups[1]).toEqual({ id: "b", name: "b", label: "B", parent: "a" });
    expect(ir.services[1]).toEqual({ id: "y", name: "y", label: "Y" });
    expect(ir.junctions).toEqual([{ id: "j", name: "j", group: "a" }]);
    expect(ir.edges.map((e) => [e.arrowFrom, e.arrowTo, e.label])).toEqual([
      [true, true, undefined],
      [false, true, 'says "hi"'],
      [true, false, undefined],
    ]);
  });

  it("keeps `{group}` only where it crosses a border", () => {
    const { ir } = ok(`architecture-beta
  group g1[G1]
  group g2[G2]
  service a(server)[A] in g1
  service b(server)[B] in g2
  service c(server)[C] in g1
  service d(server)[D]
  a{group}:R -- L:b{group}
  a{group}:B -- T:c
  d{group}:R -- L:a
`);
    expect(ir.edges[0]).toMatchObject({ groupFrom: true, groupTo: true });
    // same group: mermaid would refuse the flag, so it is settled away
    expect(ir.edges[1]!.groupFrom).toBeUndefined();
    // `d` is in no group: nothing to end on
    expect(ir.edges[2]!.groupFrom).toBeUndefined();
  });

  it("drops title, align and accessibility statements with a warning", () => {
    const r = ok(`architecture-beta
  title My system
  accTitle: acc
  service a(server)[A]
  service b(server)[B]
  align row a b
  a:R -- L:b
`);
    expect(r.ir.services).toHaveLength(2);
    expect(r.warnings.map((w) => w.message).join("\n")).toMatch(/title/);
    expect(r.warnings.map((w) => w.message).join("\n")).toMatch(/align/);
  });

  it("accepts a custom icon pack name and hyphenated ids", () => {
    const { ir } = ok(`architecture-beta
  service my-svc(logos:aws)[AWS]
  service other
  my-svc:R -- L:other
`);
    expect(ir.services[0]).toMatchObject({ name: "my-svc", icon: "logos:aws" });
    expect(ir.services[1]).toEqual({ id: "other", name: "other" });
  });

  it("reports what mermaid itself would refuse", () => {
    expect(errors("flowchart TD\nA-->B")).toEqual(["expected `architecture-beta` header"]);
    expect(errors("architecture-beta\n  service a[A]\n  service a[B]")[0]).toMatch(/already in use/);
    expect(errors("architecture-beta\n  service a[A] in nope")[0]).toMatch(/does not exist/);
    expect(errors("architecture-beta\n  service a[A]\n  service b[B] in a")[0]).toMatch(/not a group/);
    expect(errors("architecture-beta\n  group g[G] in h\n  group h[H]")[0]).toMatch(/before/);
    expect(errors("architecture-beta\n  service a[A]\n  a:R -- L:ghost")[0]).toMatch(/does not exist/);
    expect(errors("architecture-beta\n  group g[G]\n  service a[A]\n  a:R -- L:g")[0]).toMatch(/is a group/);
    expect(errors("architecture-beta\n  service a[A]\n  a:R -- L:a")[0]).toMatch(/itself/);
    expect(errors("architecture-beta\n  service group[A]")[0]).toMatch(/keyword/);
    expect(errors("architecture-beta\n  service R[A]")[0]).toMatch(/keyword/);
    expect(errors("architecture-beta\n  nonsense")[0]).toMatch(/cannot parse/);
  });

  it("round trips through codegen", () => {
    const src = `architecture-beta
  group cloud_a(cloud)["Cloud A"]
  group vpc["VPC"] in cloud_a
  service api(server)["API"] in vpc
  service db(database)["Database"] in cloud_a
  service cdn(internet)
  junction hub in cloud_a
  api:R <-- L:db
  hub{group}:B -["calls"]-> T:cdn
  cdn:L -- R:api{group}
`;
    const first = ok(src).ir;
    const text = architectureToMermaid(first);
    expect(ok(text).ir).toEqual(first);
    expect(architectureToMermaid(ok(text).ir)).toBe(text);
  });
});
