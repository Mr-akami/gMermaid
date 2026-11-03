import { describe, expect, it } from "vitest";
import type { GitBranchId, GitCommitId } from "./ids";
import { GIT_MAIN_BRANCH, gitBranchRef, gitGraphProblem, gitReferencedNames, resolveGitGraph, type GitGraphIR, type GitStep } from "./gitgraph";
import { applyGitGraphAction, tryGitGraphAction } from "./gitgraphActions";

const B = (s: string) => s as GitBranchId;
const C = (s: string) => s as GitCommitId;

const commit = (id: string, branch: GitBranchId, extra: Partial<GitStep> = {}): GitStep =>
  ({ type: "commit", id: C(id), branch, tags: [], commitType: "NORMAL", ...extra }) as GitStep;
const branch = (id: string, name: string, from: GitBranchId): GitStep => ({ type: "branch", id: B(id), name, from });

// main: c1 c2 | dev forks after c2: d1 d2 | main: c3, merge m (main ← dev)
const base: GitGraphIR = {
  kind: "gitGraph",
  direction: "LR",
  steps: [
    commit("c1", GIT_MAIN_BRANCH, { name: "one" }),
    commit("c2", GIT_MAIN_BRANCH),
    branch("dev", "develop", GIT_MAIN_BRANCH),
    commit("d1", B("dev")),
    commit("d2", B("dev")),
    commit("c3", GIT_MAIN_BRANCH),
    { type: "merge", id: C("m"), branch: GIT_MAIN_BRANCH, from: B("dev"), tags: [], commitType: "NORMAL" },
  ],
};

describe("resolveGitGraph", () => {
  it("runs the script: parents, columns and lanes", () => {
    const r = resolveGitGraph(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const parents = Object.fromEntries(r.commits.map((c) => [c.step.id, c.parents]));
    expect(parents).toEqual({ c1: [], c2: ["c1"], d1: ["c2"], d2: ["d1"], c3: ["c2"], m: ["c3", "d2"] });
    expect(r.commits.map((c) => c.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(r.lanes).toEqual([GIT_MAIN_BRANCH, "dev"]);
    expect(r.branches[1]).toMatchObject({ name: "develop", fork: "c2" });
  });

  it("sorts lanes by `order`, a branch with none counts as 0, like mermaid", () => {
    const ir: GitGraphIR = {
      ...base,
      steps: [
        commit("c1", GIT_MAIN_BRANCH),
        { ...(branch("a", "a", GIT_MAIN_BRANCH) as GitStep & { type: "branch" }), order: 5 },
        { ...(branch("b", "b", GIT_MAIN_BRANCH) as GitStep & { type: "branch" }), order: 1 },
        branch("c", "c", GIT_MAIN_BRANCH),
      ],
    };
    const r = resolveGitGraph(ir);
    expect(r.ok && r.lanes).toEqual([GIT_MAIN_BRANCH, "c", "b", "a"]);
  });

  it.each([
    ["merge a branch into itself", [commit("c1", GIT_MAIN_BRANCH), { type: "merge", id: C("m"), branch: GIT_MAIN_BRANCH, from: GIT_MAIN_BRANCH, tags: [], commitType: "NORMAL" } as GitStep], /itself/],
    ["merge a branch that does not exist", [commit("c1", GIT_MAIN_BRANCH), { type: "merge", id: C("m"), branch: GIT_MAIN_BRANCH, from: B("nope"), tags: [], commitType: "NORMAL" } as GitStep], /does not exist/],
    ["a branch named main", [branch("a", "main", GIT_MAIN_BRANCH)], /already exists/],
    ["a duplicate branch name", [branch("a", "x", GIT_MAIN_BRANCH), branch("b", "x", GIT_MAIN_BRANCH)], /already exists/],
    ["a duplicate commit id", [commit("c1", GIT_MAIN_BRANCH, { name: "n" }), commit("c2", GIT_MAIN_BRANCH, { name: "n" })], /already used/],
    ["a commit on a branch that is not there yet", [commit("c1", B("later"))], /does not exist/],
    ["text with both kinds of quote", [commit("c1", GIT_MAIN_BRANCH, { message: `a"b'c` })], /both/],
    ["a duplicate step id", [commit("c1", GIT_MAIN_BRANCH), commit("c1", GIT_MAIN_BRANCH)], /duplicate id/],
  ] as const)("refuses %s", (_name, steps, reason) => {
    const p = gitGraphProblem({ ...base, steps: [...steps] });
    expect(p).toMatch(reason);
  });

  it("refuses the merge cases mermaid refuses: same head, empty target, branch merged into the one it forked from", () => {
    const sameHead: GitGraphIR = {
      ...base,
      steps: [commit("c1", GIT_MAIN_BRANCH), branch("a", "a", GIT_MAIN_BRANCH), { type: "merge", id: C("m"), branch: GIT_MAIN_BRANCH, from: B("a"), tags: [], commitType: "NORMAL" }],
    };
    expect(gitGraphProblem(sameHead)).toMatch(/same head/);
    const forkedFrom: GitGraphIR = {
      ...base,
      steps: [commit("c1", GIT_MAIN_BRANCH), branch("a", "a", GIT_MAIN_BRANCH), commit("c2", GIT_MAIN_BRANCH), { type: "merge", id: C("m"), branch: B("a"), from: GIT_MAIN_BRANCH, tags: [], commitType: "NORMAL" }],
    };
    // `a` has no commit of its own: its head IS c1, made on main
    expect(gitGraphProblem(forkedFrom)).toMatch(/into itself/);
  });

  it("validates cherry-picks: no self-branch, merge sources need a parent, parents must be parents", () => {
    const pick = (extra: object, onto = B("dev")): GitStep =>
      ({ type: "cherryPick", id: C("p"), branch: onto, source: C("c3"), tags: [], ...extra }) as GitStep;
    expect(gitGraphProblem({ ...base, steps: [...base.steps.slice(0, 5), commit("c3", GIT_MAIN_BRANCH), pick({})] })).toBeUndefined();
    expect(gitGraphProblem({ ...base, steps: [...base.steps.slice(0, 5), commit("c3", GIT_MAIN_BRANCH), pick({}, GIT_MAIN_BRANCH)] })).toMatch(/already on this branch/);
    // a merge source
    const withMerge = [...base.steps, branch("e", "e", GIT_MAIN_BRANCH), commit("e1", B("e"))];
    expect(gitGraphProblem({ ...base, steps: [...withMerge, pick({ source: C("m") }, B("e"))] })).toMatch(/needs a parent/);
    expect(gitGraphProblem({ ...base, steps: [...withMerge, pick({ source: C("m"), parent: C("d1") }, B("e"))] })).toMatch(/immediate parent/);
    expect(gitGraphProblem({ ...base, steps: [...withMerge, pick({ source: C("m"), parent: C("d2") }, B("e"))] })).toBeUndefined();
    // a cherry-pick has no id mermaid could name
    const picked = [...withMerge, pick({ source: C("m"), parent: C("d2") }, B("e"))];
    expect(gitGraphProblem({ ...base, steps: [...picked, { ...pick({ source: C("p") }, B("dev")), id: C("p2") } as GitStep] })).toMatch(/no id/);
  });
});

describe("gitReferencedNames / gitBranchRef", () => {
  it("names only the commits a cherry-pick needs, never colliding with a given id", () => {
    const ir: GitGraphIR = {
      ...base,
      steps: [
        commit("c1", GIT_MAIN_BRANCH, { name: "c1" }),
        branch("a", "a", GIT_MAIN_BRANCH),
        commit("x", B("a")),
        { type: "cherryPick", id: C("p"), branch: GIT_MAIN_BRANCH, source: C("x"), tags: [] },
      ],
    };
    expect([...gitReferencedNames(ir)]).toEqual([[C("x"), "c2"]]);
  });

  it("quotes a branch name the lexer would not read back as one word", () => {
    expect(gitBranchRef("dev")).toBe("dev");
    for (const n of ["commit", "2", "has space", "日本語", "-x", "type"]) expect(gitBranchRef(n)).toBe(`"${n}"`);
  });
});

describe("applyGitGraphAction", () => {
  it("adds steps at the end and refuses what would not run, with the reason", () => {
    const next = applyGitGraphAction(base, { type: "addStep", step: commit("c4", GIT_MAIN_BRANCH) });
    expect(next.steps.at(-1)!.id).toBe("c4");
    const bad = { type: "addStep", step: branch("z", "main", GIT_MAIN_BRANCH) } as const;
    expect(applyGitGraphAction(base, bad)).toBe(base);
    expect(tryGitGraphAction(base, bad)).toEqual({ ok: false, reason: "branch name: `main` already exists" });
  });

  it("is identity on no-ops", () => {
    expect(applyGitGraphAction(base, { type: "setDirection", direction: "LR" })).toBe(base);
    expect(applyGitGraphAction(base, { type: "removeStep", id: "nope" })).toBe(base);
    expect(applyGitGraphAction(base, { type: "updateCommit", id: C("c1"), patch: { name: "one" } })).toBe(base);
    expect(applyGitGraphAction(base, { type: "updateBranch", id: B("dev"), name: "develop" })).toBe(base);
    expect(applyGitGraphAction(base, { type: "moveStep", id: "c1", delta: -1 })).toBe(base);
  });

  it("updates commits and branches, `null` clears, and checks the result", () => {
    let ir = applyGitGraphAction(base, { type: "updateCommit", id: C("c2"), patch: { name: "two", message: "hello", tags: ["v1", "v2"], commitType: "HIGHLIGHT" } });
    expect(ir.steps[1]).toMatchObject({ name: "two", message: "hello", tags: ["v1", "v2"], commitType: "HIGHLIGHT" });
    ir = applyGitGraphAction(ir, { type: "updateCommit", id: C("c2"), patch: { name: null, message: null } });
    expect(ir.steps[1]).not.toHaveProperty("name");
    expect(ir.steps[1]).not.toHaveProperty("message");
    // `one` is taken by c1
    expect(tryGitGraphAction(base, { type: "updateCommit", id: C("c2"), patch: { name: "one" } }).ok).toBe(false);
    expect(applyGitGraphAction(base, { type: "updateBranch", id: B("dev"), name: "main" })).toBe(base);
    const ordered = applyGitGraphAction(base, { type: "updateBranch", id: B("dev"), order: 2 });
    expect(ordered.steps[2]).toMatchObject({ order: 2 });
    expect(applyGitGraphAction(ordered, { type: "updateBranch", id: B("dev"), order: null }).steps[2]).not.toHaveProperty("order");
  });

  it("moves a commit past the next commit, `branch` lines included, and refuses a move that breaks the script", () => {
    // c2 later: passes `branch dev` and d1 — but then dev forks before c2 and
    // `d1`'s parent changes; still runs
    const moved = applyGitGraphAction(base, { type: "moveStep", id: "c2", delta: 1 });
    expect(moved.steps.map((s) => s.id)).toEqual(["c1", "dev", "d1", "c2", "d2", "c3", "m"]);
    // the merge cannot move before the commits it joins
    expect(tryGitGraphAction(base, { type: "moveStep", id: "m", delta: -1 }).ok).toBe(true);
    // d1 cannot move before the `branch dev` line that creates its branch
    expect(tryGitGraphAction(base, { type: "moveStep", id: "d1", delta: -1 }).ok).toBe(false);
    // a branch line cannot move before the branch it forks from exists
    const nested: GitGraphIR = { ...base, steps: [branch("a", "a", GIT_MAIN_BRANCH), branch("b", "b", B("a"))] };
    expect(tryGitGraphAction(nested, { type: "moveStep", id: "b", delta: -1 })).toMatchObject({ ok: false });
  });

  it("removes a branch with everything that cannot exist without it", () => {
    const next = applyGitGraphAction(base, { type: "removeStep", id: "dev" });
    // dev's commits and the merge of dev go with it
    expect(next.steps.map((s) => s.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("removes a commit together with the cherry-picks of it", () => {
    const ir: GitGraphIR = {
      ...base,
      steps: [...base.steps, branch("e", "e", GIT_MAIN_BRANCH), commit("e1", B("e")), { type: "cherryPick", id: C("p"), branch: B("e"), source: C("c3"), tags: [] }],
    };
    expect(applyGitGraphAction(ir, { type: "removeStep", id: "c3" }).steps.map((s) => s.id)).not.toContain("p");
  });

  it("refuses a removal that leaves a script mermaid would refuse", () => {
    // without d1, `merge dev` joins two branches with the same head
    const small: GitGraphIR = {
      ...base,
      steps: [
        commit("c1", GIT_MAIN_BRANCH),
        branch("dev", "develop", GIT_MAIN_BRANCH),
        commit("d1", B("dev")),
        { type: "merge", id: C("m"), branch: GIT_MAIN_BRANCH, from: B("dev"), tags: [], commitType: "NORMAL" },
      ],
    };
    expect(tryGitGraphAction(small, { type: "removeStep", id: "d1" })).toEqual({ ok: false, reason: "both branches have the same head" });
  });

  it("sets the direction", () => {
    expect(applyGitGraphAction(base, { type: "setDirection", direction: "BT" }).direction).toBe("BT");
  });
});
