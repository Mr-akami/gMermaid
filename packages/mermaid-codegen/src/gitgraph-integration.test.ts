// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import mermaid from "mermaid";
import { GIT_MAIN_BRANCH, resolveGitGraph, type GitBranchId, type GitCommitId, type GitGraphIR, type GitStep } from "@gmermaid/ir";
import { parseGitGraph } from "@gmermaid/mermaid-parser";
import { gitGraphToMermaid } from "./gitgraph";

// The git graph is the one kind whose MEANING lives in mermaid's runtime: the
// text is a script, and mermaid builds the graph by running it. So beyond
// "mermaid accepts what codegen writes", this file holds our simulator
// (`resolveGitGraph`) against mermaid's own database for the same text —
// the parents, branch of origin, commit type and lane order must agree.

const H = "gitGraph";

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false });
});

const B = (s: string) => s as GitBranchId;
const C = (s: string) => s as GitCommitId;
const c = (id: string, branch: GitBranchId, extra: object = {}): GitStep =>
  ({ type: "commit", id: C(id), branch, tags: [], commitType: "NORMAL", ...extra }) as GitStep;

const ir = (steps: GitStep[], direction: GitGraphIR["direction"] = "LR"): GitGraphIR => ({ kind: "gitGraph", direction, steps });

interface MermaidCommit {
  id: string;
  parents: string[];
  branch: string;
  type: number;
  tags: string[];
  customType?: number | null;
}
interface MermaidDb {
  getCommits(): Map<string, MermaidCommit>;
  getBranchesAsObjArray(): { name: string }[];
  getDirection(): string;
}

async function runInMermaid(code: string): Promise<MermaidDb> {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(code);
  return diagram.db as unknown as MermaidDb;
}

async function expectMermaidAccepts(code: string): Promise<void> {
  await expect(mermaid.parse(code), code).resolves.toBeTruthy();
}

// mermaid's commit type enum
const TYPE = { NORMAL: 0, REVERSE: 1, HIGHLIGHT: 2, MERGE: 3, CHERRY_PICK: 4 } as const;

async function expectSameRun(code: string): Promise<void> {
  const parsed = parseGitGraph(code);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const run = resolveGitGraph(parsed.ir);
  if (!run.ok) throw new Error(run.message);

  // our text, not only the user's: both must mean the same thing
  for (const text of [code, gitGraphToMermaid(parsed.ir)]) {
    const db = await runInMermaid(text);
    const theirs = [...db.getCommits().values()];
    expect(theirs, text).toHaveLength(run.commits.length);
    const index = new Map(theirs.map((t, i) => [t.id, i] as const));
    const branchName = new Map(run.branches.map((b) => [b.id, b.name] as const));

    run.commits.forEach((ours, i) => {
      const t = theirs[i]!;
      expect(t.parents.map((p) => index.get(p)), `${text} #${i} parents`).toEqual(ours.parents.map((p) => run.commits.find((x) => x.step.id === p)!.seq));
      expect(t.branch, `#${i} branch`).toBe(branchName.get(ours.branch));
      const s = ours.step;
      const type = s.type === "merge" ? TYPE.MERGE : s.type === "cherryPick" ? TYPE.CHERRY_PICK : TYPE[s.commitType];
      expect(t.type, `#${i} type`).toBe(type);
      // a merge's own `type:` travels as `customType`
      if (s.type === "merge" && s.commitType !== "NORMAL") expect(t.customType).toBe(TYPE[s.commitType]);
      if (s.type !== "cherryPick") expect(t.tags, `#${i} tags`).toEqual(s.tags);
    });

    expect(db.getBranchesAsObjArray().map((b) => b.name), `${text} lanes`).toEqual(run.lanes.map((id) => branchName.get(id)));
    expect(db.getDirection()).toBe(parsed.ir.direction);
  }
}

describe("mermaid.js accepts generated git graphs", () => {
  it("parses every statement, option and orientation", async () => {
    const steps: GitStep[] = [
      c("c1", GIT_MAIN_BRANCH, { name: "init", message: "first", tags: ["v0", "v 1"], commitType: "HIGHLIGHT" }),
      c("c2", GIT_MAIN_BRANCH, { commitType: "REVERSE", message: `it"s` }),
      { type: "branch", id: B("dev"), name: "develop", from: GIT_MAIN_BRANCH, order: 2 },
      c("d1", B("dev"), { name: "wip" }),
      { type: "branch", id: B("odd"), name: "feature/x y", from: B("dev") },
      c("o1", B("odd")),
      { type: "branch", id: B("kw"), name: "commit", from: GIT_MAIN_BRANCH },
      { type: "branch", id: B("num"), name: "2", from: GIT_MAIN_BRANCH },
      { type: "branch", id: B("ja"), name: "日本語", from: GIT_MAIN_BRANCH },
      c("c3", GIT_MAIN_BRANCH),
      { type: "merge", id: C("m1"), branch: GIT_MAIN_BRANCH, from: B("dev"), name: "release", tags: ["v1"], commitType: "REVERSE" },
      { type: "merge", id: C("m2"), branch: B("odd"), from: B("dev"), tags: [], commitType: "HIGHLIGHT" },
      { type: "cherryPick", id: C("p1"), branch: B("kw"), source: C("c3"), tags: [] },
      { type: "cherryPick", id: C("p2"), branch: B("num"), source: C("m1"), parent: C("c3"), tags: ["picked", "twice"] },
      { type: "cherryPick", id: C("p3"), branch: B("ja"), source: C("d1"), tags: [] },
    ];
    for (const direction of ["LR", "TB", "BT"] as const) await expectMermaidAccepts(gitGraphToMermaid(ir(steps, direction)));
  });

  it("parses a graph with only a header, and one with a branch and no commits", async () => {
    await expectMermaidAccepts(gitGraphToMermaid(ir([])));
    await expectMermaidAccepts(gitGraphToMermaid(ir([{ type: "branch", id: B("a"), name: "a", from: GIT_MAIN_BRANCH }])));
  });
});

describe("our simulator agrees with mermaid's own", () => {
  const cases: Record<string, string> = {
    "the docs sample": `${H}\n commit\n commit\n branch develop\n checkout develop\n commit\n commit\n checkout main\n merge develop\n commit\n commit\n`,
    "options and types": `${H} TB:\n commit id: "a" tag: "v1" tag: "v2" type: HIGHLIGHT\n branch dev\n commit msg: "m" type: REVERSE\n checkout main\n merge dev id: "mm" tag: "t" type: REVERSE\n`,
    "forks from forks, with a second merge of the same branch": `${H} BT:\n commit\n branch a\n commit\n branch b\n commit\n checkout a\n merge b\n checkout main\n commit\n merge a\n merge a\n`,
    "lane order, with ties": `${H}\n commit\n branch a order: 3\n branch b order: 1\n branch c\n branch d order: 3\n branch e order: 0\n`,
    "cherry-picks, incl. a merge via its parent": `${H}
 commit id: "x"
 branch dev
 commit id: "y"
 checkout main
 commit id: "c"
 merge dev id: "m"
 branch f
 commit id: "q"
 cherry-pick id: "m" parent: "y" tag: "mine"
 cherry-pick id: "c"
 cherry-pick id: "y" tag: "a" tag: "b"
`,
    "a branch forked from an empty main": `${H}\n branch a\n commit\n branch b\n commit\n checkout a\n commit\n checkout main\n branch c\n`,
  };
  for (const [name, code] of Object.entries(cases)) {
    it(name, async () => {
      await expectSameRun(code);
    });
  }

  it("refuses the same scripts mermaid refuses", async () => {
    const refused = [
      `${H}\n commit\n branch dev\n checkout main\n merge dev\n`, // same head
      `${H}\n branch dev\n merge dev\n`, // into itself
      `${H}\n commit\n branch a\n commit\n checkout main\n branch b\n merge b\n`, // into itself
      `${H}\n commit id: "x"\n branch dev\n checkout main\n cherry-pick id: "x"\n`, // already on the branch
      `${H}\n commit id: "x"\n branch dev\n commit\n checkout main\n merge dev id: "m"\n branch f\n commit\n cherry-pick id: "m"\n`, // merge needs a parent
      `${H}\n commit id: "x"\n branch dev\n commit id: "y"\n checkout main\n merge dev id: "m"\n branch f\n commit\n cherry-pick id: "m" parent: "nope"\n`,
      `${H}\n commit id: "x"\n branch dev\n commit id: "y"\n checkout main\n commit id: "c"\n merge dev id: "m"\n branch f\n commit\n cherry-pick id: "m" parent: "x"\n`, // not an immediate parent
    ];
    for (const code of refused) {
      await expect(runInMermaid(code), code).rejects.toThrow();
      const parsed = parseGitGraph(code);
      expect(parsed.ok, code).toBe(false);
    }
  });
});
