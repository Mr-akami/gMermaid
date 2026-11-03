import { describe, expect, it } from "vitest";
import { gitGraphToMermaid } from "@gmermaid/mermaid-codegen";
import { GIT_MAIN_BRANCH, type GitGraphIR } from "@gmermaid/ir";
import { parseGitGraph } from "./gitgraph";

const H = "gitGraph";

const ok = (code: string): GitGraphIR => {
  const r = parseGitGraph(code);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.ir;
};
const errors = (code: string) => {
  const r = parseGitGraph(code);
  return r.ok ? [] : r.errors;
};

/** parse → codegen → parse must land on the same IR, and codegen must be stable. */
const expectRoundTrip = (code: string) => {
  const first = ok(code);
  const regen = gitGraphToMermaid(first);
  const back = ok(regen);
  expect(back).toEqual(first);
  expect(gitGraphToMermaid(back)).toBe(regen);
};

const DOCS = `${H}
  commit
  commit
  branch develop
  checkout develop
  commit
  commit
  checkout main
  merge develop
  commit
  commit
`;

describe("parseGitGraph", () => {
  it("parses the docs sample: branches, checkout and merge become explicit steps", () => {
    const ir = ok(DOCS);
    expect(ir.direction).toBe("LR");
    expect(ir.steps.map((s) => [s.type, s.type === "branch" ? s.name : s.branch === GIT_MAIN_BRANCH ? "main" : "develop"])).toEqual([
      ["commit", "main"],
      ["commit", "main"],
      ["branch", "develop"],
      ["commit", "develop"],
      ["commit", "develop"],
      ["merge", "main"],
      ["commit", "main"],
      ["commit", "main"],
    ]);
    expectRoundTrip(DOCS);
  });

  it("reads commit id / message / tags / type in any spelling", () => {
    const ir = ok(`${H}
  commit "just a message"
  commit id:"a" msg:"m" tag:"v1" tag: "v2" type:HIGHLIGHT
  commit type: REVERSE tag: 'it"s'
`);
    const [c1, c2, c3] = ir.steps;
    expect(c1).toMatchObject({ type: "commit", message: "just a message", tags: [], commitType: "NORMAL" });
    expect(c2).toMatchObject({ name: "a", message: "m", tags: ["v1", "v2"], commitType: "HIGHLIGHT" });
    expect(c3).toMatchObject({ tags: ['it"s'], commitType: "REVERSE" });
    expectRoundTrip(`${H}\n  commit id:"a" msg:"m" tag:"v1" tag: "v2" type:HIGHLIGHT\n  commit tag: 'it"s'\n`);
  });

  it("reads orientation headers, and refuses one without its colon (mermaid does too)", () => {
    for (const dir of ["LR", "TB", "BT"] as const) {
      expect(ok(`${H} ${dir}:\n  commit\n`).direction).toBe(dir);
      expectRoundTrip(`${H} ${dir}:\n  commit\n  branch a\n  commit\n`);
    }
    expect(ok(`${H}:\n commit`).direction).toBe("LR");
    expect(errors(`${H} TB\n commit`)[0]!.message).toMatch(/needs its colon/);
  });

  it("reads branch order, quoted names, `switch`, and bare names with `/` `.` `-`", () => {
    const ir = ok(`${H}
  commit
  branch dev order: 3
  branch "feature x" order: 1
  switch dev
  commit
  branch feat/a.b-c
`);
    expect(ir.steps.filter((s) => s.type === "branch")).toMatchObject([
      { name: "dev", order: 3, from: GIT_MAIN_BRANCH },
      { name: "feature x", order: 1 },
      { name: "feat/a.b-c" },
    ]);
    // `checkout dev` made `dev` current, so `feat/a.b-c` forks from it
    const last = ir.steps.at(-1)!;
    const dev = ir.steps.find((s) => s.type === "branch" && s.name === "dev")!;
    expect(last).toMatchObject({ type: "branch", from: dev.id });
    expectRoundTrip(`${H}\n  commit\n  branch dev order: 3\n  branch "feature x" order: 1\n  commit\n`);
  });

  it("cherry-picks by commit id, with a parent for a merge", () => {
    const code = `${H}
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
`;
    const ir = ok(code);
    const picks = ir.steps.filter((s) => s.type === "cherryPick");
    expect(picks).toHaveLength(2);
    expect(picks[0]).toMatchObject({ tags: ["mine"] });
    expect(picks[0]).toHaveProperty("parent");
    expect(picks[1]).not.toHaveProperty("parent");
    expectRoundTrip(code);
  });

  it("drops styling, title and accessibility lines with a warning, and tolerates frontmatter and comments", () => {
    const r = parseGitGraph(`---
config:
  gitGraph:
    showBranches: false
---
%%{init: {"gitGraph": {"mainBranchName": "main"}} }%%
${H}
  title Some title
  accTitle: t
  accDescr: d
  %% a comment
  commit id: "a" %% trailing
  style x fill:#f00
`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ir.steps).toHaveLength(1);
    expect(r.warnings.map((w) => w.message.split("`")[1])).toEqual(["title", "accTitle", "accDescr", "style"]);
  });

  it("names the line a script breaks on, as mermaid would refuse it", () => {
    expect(errors(`${H}\n  commit\n  checkout nope\n`)).toEqual([
      { line: 3, message: "branch `nope` does not exist (create it with `branch nope`)" },
    ]);
    expect(errors(`${H}\n  commit\n  branch main\n`)[0]).toMatchObject({ line: 3 });
    expect(errors(`${H}\n  commit\n  branch a\n  commit\n  checkout main\n  merge a\n  merge a\n`)).toEqual([]);
    expect(errors(`${H}\n  commit\n  branch a\n  checkout main\n  merge a\n`)).toEqual([
      { line: 5, message: "both branches have the same head" },
    ]);
    expect(errors(`${H}\n  branch a\n  merge a\n`)[0]!.message).toMatch(/itself/);
    expect(errors(`${H}\n  commit id: "x"\n  commit id: "x"\n`)).toEqual([{ line: 3, message: "commit id `x` is already used" }]);
    expect(errors(`${H}\n  commit id: "x"\n  cherry-pick id: "x"\n`)[0]!.message).toMatch(/already on this branch/);
    expect(errors(`${H}\n  cherry-pick id: "nope"\n`)[0]!.message).toMatch(/no commit with id `nope`/);
    expect(
      errors(`${H}\n  commit id: "x"\n  branch a\n  commit id: "y"\n  checkout main\n  merge a id: "m"\n  branch b\n  cherry-pick id: "m"\n`)[0]!.message,
    ).toMatch(/needs a parent/);
  });

  it("refuses what mermaid's lexer would: bare keywords and odd names as branch names", () => {
    expect(errors(`${H}\n  commit\n  branch commit\n`)[0]!.message).toMatch(/put it in quotes/);
    expect(errors(`${H}\n  commit\n  branch 2\n`)[0]!.message).toMatch(/put it in quotes/);
    expect(ok(`${H}\n  commit\n  branch "2"\n`).steps).toHaveLength(2);
  });

  it("reports malformed statements by token", () => {
    expect(errors(`${H}\n  commit id\n`)[0]!.message).toMatch(/unexpected `id`/);
    expect(errors(`${H}\n  commit type: NOPE\n`)[0]!.message).toMatch(/type must be/);
    expect(errors(`${H}\n  commit msg: unquoted\n`)[0]!.message).toMatch(/quoted string/);
    expect(errors(`${H}\n  commit "unterminated\n`)[0]!.message).toMatch(/unterminated/);
    expect(errors(`${H}\n  frobnicate\n`)[0]!.message).toMatch(/cannot parse/);
    expect(errors(`flowchart TD\n`)[0]!.message).toMatch(/expected/);
  });
});
