import { describe, expect, it } from "vitest";
import { GIT_MAIN_BRANCH, type GitBranchId, type GitCommitId, type GitGraphIR, type GitStep } from "@gmermaid/ir";
import { fixedWidthMeasurer } from "./measurer";
import { layoutGitGraph } from "./gitgraph";
import { marqueeHits } from "./marquee";

const B = (s: string) => s as GitBranchId;
const C = (s: string) => s as GitCommitId;
const commit = (id: string, branch: GitBranchId, extra: object = {}): GitStep =>
  ({ type: "commit", id: C(id), branch, tags: [], commitType: "NORMAL", ...extra }) as GitStep;

const steps: GitStep[] = [
  commit("c1", GIT_MAIN_BRANCH, { name: "init" }),
  commit("c2", GIT_MAIN_BRANCH, { tags: ["v1"] }),
  { type: "branch", id: B("dev"), name: "develop", from: GIT_MAIN_BRANCH },
  commit("d1", B("dev"), { name: "wip", commitType: "HIGHLIGHT" }),
  commit("d2", B("dev")),
  commit("c3", GIT_MAIN_BRANCH),
  { type: "merge", id: C("m"), branch: GIT_MAIN_BRANCH, from: B("dev"), tags: [], commitType: "NORMAL" },
  { type: "cherryPick", id: C("p"), branch: B("dev"), source: C("c3"), tags: [] },
];
const ir = (direction: GitGraphIR["direction"]): GitGraphIR => ({ kind: "gitGraph", direction, steps });
const measure = fixedWidthMeasurer();

describe("layoutGitGraph", () => {
  it("matches the committed golden layout", () => {
    expect(layoutGitGraph(ir("LR"), measure)).toMatchSnapshot();
  });

  it("LR: one column per commit in script order, one row per lane", () => {
    const l = layoutGitGraph(ir("LR"), measure);
    const xs = l.commits.map((c) => c.center.x);
    expect(xs.toSorted((a, b) => a - b)).toEqual(xs);
    expect(new Set(xs).size).toBe(xs.length);
    const y = (id: string) => l.commits.find((c) => c.id === id)!.center.y;
    expect(y("c1")).toBe(y("c3"));
    expect(y("d1")).toBe(y("d2"));
    expect(y("d1")).toBeGreaterThan(y("c1"));
    expect(l.lanes.map((x) => x.name)).toEqual(["main", "develop"]);
  });

  it("TB runs time down and lanes across; BT mirrors it", () => {
    const tb = layoutGitGraph(ir("TB"), measure);
    const ys = tb.commits.map((c) => c.center.y);
    expect(ys.toSorted((a, b) => a - b)).toEqual(ys);
    expect(tb.commits.find((c) => c.id === "d1")!.center.x).toBeGreaterThan(tb.commits.find((c) => c.id === "c1")!.center.x);

    const bt = layoutGitGraph(ir("BT"), measure);
    const up = bt.commits.map((c) => c.center.y);
    expect(up.toSorted((a, b) => b - a)).toEqual(up);
    // the branch labels sit at the end the history starts from
    expect(bt.lanes[0]!.rect.y).toBeGreaterThan(Math.max(...up));
    expect(tb.lanes[0]!.rect.y + tb.lanes[0]!.rect.h).toBeLessThan(Math.min(...ys));
  });

  it("draws an edge per parent, curved between lanes, with the cherry-pick source dashed", () => {
    const l = layoutGitGraph(ir("LR"), measure);
    const edge = (from: string, to: string) => l.edges.find((e) => e.from === from && e.to === to)!;
    expect(edge("c1", "c2").d).toMatch(/^M [\d.]+ [\d.]+ L /);
    expect(edge("c2", "d1").d).toContain(" C ");
    // a merge has two parents; a cherry-pick's second one is its source
    expect(l.edges.filter((e) => e.to === "m")).toHaveLength(2);
    expect(edge("c3", "p").dashed).toBe(true);
    expect(edge("d2", "p").dashed).toBe(false);
  });

  it("labels: id, merge target, tags (default cherry-pick tag when none given)", () => {
    const l = layoutGitGraph(ir("LR"), measure);
    const node = (id: string) => l.commits.find((c) => c.id === id)!;
    expect(node("c1").label).toBe("init");
    expect(node("m").label).toBe("merge develop");
    expect(node("c2").tags).toBe("v1");
    expect(node("p").kind).toBe("cherryPick");
    expect(node("p").tags).toMatch(/^cherry-pick/);
    expect(node("d1").commitType).toBe("HIGHLIGHT");
  });

  it("lets the marquee select commits and branch labels", () => {
    const l = layoutGitGraph(ir("LR"), measure);
    const c1 = l.commits.find((c) => c.id === "c1")!;
    expect(marqueeHits(l, c1.rect)).toContain("c1");
    expect(marqueeHits(l, l.lanes[1]!.rect)).toContain("dev");
  });

  it("returns finite sizes for an empty graph, and pure JSON data", () => {
    const empty = layoutGitGraph({ kind: "gitGraph", direction: "LR", steps: [] }, measure);
    expect(Number.isFinite(empty.size.w) && Number.isFinite(empty.size.h)).toBe(true);
    expect(empty.lanes).toHaveLength(1);
    const l = layoutGitGraph(ir("TB"), measure);
    expect(JSON.parse(JSON.stringify(l))).toEqual(l);
  });
});
