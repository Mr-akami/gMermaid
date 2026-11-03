import type { GitBranchId, GitCommitId } from "./ids";

// Git graphs. Mermaid's text is a SCRIPT: `commit`, `branch x`, `checkout x`,
// `merge x`, `cherry-pick id:"c"` run against a running "current branch". The
// IR keeps the script's order (it is the diagram's time axis) but drops the
// implicit state: every step names its branch explicitly, and codegen derives
// the `checkout` lines that make the script say the same thing.
//
// Mermaid derives the graph by running the script, so the IR has to be a
// script that RUNS — `resolveGitGraph` is the one simulator, shared by the
// reducer (reject what mermaid would refuse), the parser (report the step
// that failed), layout (parents, lanes) and clipboard.

/** The branch every graph starts with. Mermaid creates it implicitly, so it
 * has no step of its own. */
export const GIT_MAIN_BRANCH = "branch-main" as GitBranchId;
export const GIT_MAIN_NAME = "main";

export type GitDirection = "LR" | "TB" | "BT";
export const GIT_DIRECTIONS: readonly GitDirection[] = ["LR", "TB", "BT"];

export type GitCommitType = "NORMAL" | "REVERSE" | "HIGHLIGHT";
export const GIT_COMMIT_TYPES: readonly GitCommitType[] = ["NORMAL", "REVERSE", "HIGHLIGHT"];

/** `branch name [order: n]`: forks from the head of `from` (the branch that
 * was current when the line ran) and becomes the current branch. */
export interface GitBranchStep {
  readonly type: "branch";
  readonly id: GitBranchId;
  /** Never `main`, unique, and quotable (see `gitBranchNameRejection`). */
  readonly name: string;
  readonly from: GitBranchId;
  /** Lane position hint: lanes sort by `order` (none = 0), then declaration. */
  readonly order?: number;
}

/** `commit [id: "name"] [msg: "…"] [tag: "…"]… [type: …]` on `branch`. */
export interface GitCommitStep {
  readonly type: "commit";
  readonly id: GitCommitId;
  readonly branch: GitBranchId;
  /** Mermaid's `id:`. Absent = mermaid mints one. Unique across commits. */
  readonly name?: string;
  readonly message?: string;
  readonly tags: readonly string[];
  readonly commitType: GitCommitType;
}

/** `merge from [id] [tag]… [type]`, run while `branch` is current. */
export interface GitMergeStep {
  readonly type: "merge";
  readonly id: GitCommitId;
  /** The branch merged INTO. */
  readonly branch: GitBranchId;
  readonly from: GitBranchId;
  readonly name?: string;
  readonly tags: readonly string[];
  readonly commitType: GitCommitType;
}

/** `cherry-pick id: "src" [parent: "p"] [tag: "…"]…`, run while `branch` is
 * current. Mermaid gives the new commit no id of its own, so nothing can
 * cherry-pick (or name as a parent) a cherry-pick. */
export interface GitCherryPickStep {
  readonly type: "cherryPick";
  readonly id: GitCommitId;
  readonly branch: GitBranchId;
  readonly source: GitCommitId;
  /** Required when `source` is a merge; any immediate parent of `source`. */
  readonly parent?: GitCommitId;
  /** Empty = mermaid's own `cherry-pick:<id>` tag. */
  readonly tags: readonly string[];
}

export type GitCommitLikeStep = GitCommitStep | GitMergeStep | GitCherryPickStep;
export type GitStep = GitBranchStep | GitCommitLikeStep;

export interface GitGraphIR {
  readonly kind: "gitGraph";
  readonly direction: GitDirection;
  readonly steps: readonly GitStep[];
}

export function emptyGitGraph(): GitGraphIR {
  return { kind: "gitGraph", direction: "LR", steps: [] };
}

export function isGitCommitLike(step: GitStep): step is GitCommitLikeStep {
  return step.type !== "branch";
}

// ----------------------------------------------------------------- text rules

/** Words the mermaid lexer claims: a branch spelled as one must be quoted. */
export const GIT_KEYWORDS: ReadonlySet<string> = new Set([
  "gitGraph",
  "commit",
  "branch",
  "checkout",
  "switch",
  "merge",
  "cherry-pick",
  "id",
  "msg",
  "tag",
  "type",
  "order",
  "parent",
  "NORMAL",
  "REVERSE",
  "HIGHLIGHT",
  "LR",
  "TB",
  "BT",
  "title",
  "accTitle",
  "accDescr",
]);

/** Why `text` cannot sit inside a mermaid string, or undefined. Strings are
 * quoted with `"` (or `'` when the text holds a `"`); mermaid has no escape,
 * so text holding both is inexpressible. `%%` would start a comment. */
export function gitTextRejection(text: string): string | undefined {
  if (text.trim() === "") return "text cannot be empty";
  if (/[\r\n]/.test(text)) return "line breaks are not allowed here";
  if (text.includes('"') && text.includes("'")) return "cannot hold both `\"` and `'` (mermaid has no escape)";
  if (text.includes("%%")) return "`%%` is not allowed (starts a mermaid comment)";
  return undefined;
}

export function gitBranchNameRejection(name: string): string | undefined {
  const text = gitTextRejection(name);
  if (text !== undefined) return text;
  if (name === GIT_MAIN_NAME) return "`main` already exists";
  return undefined;
}

/** `commit name` / tag / message: any quotable text. */
export const gitLabelRejection = gitTextRejection;

/** The branch's name as it appears in text: bare when the mermaid lexer reads
 * it back as one word, else quoted. */
export function gitQuote(text: string): string {
  return text.includes('"') ? `'${text}'` : `"${text}"`;
}
export function gitBranchRef(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !GIT_KEYWORDS.has(name) ? name : gitQuote(name);
}

// ------------------------------------------------------------------ simulator

export interface GitCommit {
  readonly step: GitCommitLikeStep;
  /** Position in the step list. */
  readonly index: number;
  /** Column: the nth commit-like step, from 0. */
  readonly seq: number;
  /** The branch it was made on (the `branch` of its step). */
  readonly branch: GitBranchId;
  /** [head of the branch, then the merged / picked commit]. */
  readonly parents: readonly GitCommitId[];
}

export interface GitBranch {
  readonly id: GitBranchId;
  readonly name: string;
  readonly order?: number;
  /** Position of its `branch` step; -1 for main. */
  readonly index: number;
  /** The commit it forked from, if its parent branch had one. */
  readonly fork?: GitCommitId;
}

export type GitResolution =
  | {
      readonly ok: true;
      readonly commits: readonly GitCommit[];
      /** Declaration order (main first). */
      readonly branches: readonly GitBranch[];
      /** Lane order, as mermaid sorts them: by `order` (none = 0), then declaration. */
      readonly lanes: readonly GitBranchId[];
    }
  | { readonly ok: false; readonly index: number; readonly message: string };

export function gitLabel(c: GitCommitLikeStep): string | undefined {
  return c.type === "cherryPick" ? undefined : c.name;
}

/** Run the script the way mermaid does and report the first step it would
 * refuse. The checks mirror mermaid's own (`merge` into itself, same head,
 * cherry-picking from the branch you are on, …), plus what only the text
 * format needs: quotable strings and unique names. */
export function resolveGitGraph(ir: GitGraphIR): GitResolution {
  const branches: GitBranch[] = [{ id: GIT_MAIN_BRANCH, name: GIT_MAIN_NAME, index: -1 }];
  const heads = new Map<GitBranchId, GitCommitId | undefined>([[GIT_MAIN_BRANCH, undefined]]);
  const commits: GitCommit[] = [];
  const byId = new Map<string, GitCommit>();
  const ids = new Set<string>([GIT_MAIN_BRANCH]);
  const branchNames = new Set<string>([GIT_MAIN_NAME]);
  const commitNames = new Set<string>();
  const nameOf = (id: GitBranchId): string => branches.find((b) => b.id === id)?.name ?? id;

  for (const [index, step] of ir.steps.entries()) {
    const fail = (message: string): GitResolution => ({ ok: false, index, message });
    if (ids.has(step.id)) return fail("duplicate id");
    ids.add(step.id);

    if (step.type === "branch") {
      if (!heads.has(step.from)) return fail(`\`${step.name}\` forks from a branch that does not exist yet`);
      const bad = gitBranchNameRejection(step.name);
      if (bad !== undefined) return fail(`branch name: ${bad}`);
      if (branchNames.has(step.name)) return fail(`branch \`${step.name}\` already exists`);
      if (step.order !== undefined && !(Number.isInteger(step.order) && step.order >= 0)) {
        return fail("branch order must be a whole number, 0 or more");
      }
      branchNames.add(step.name);
      const fork = heads.get(step.from);
      branches.push({
        id: step.id,
        name: step.name,
        ...(step.order !== undefined ? { order: step.order } : {}),
        index,
        ...(fork !== undefined ? { fork } : {}),
      });
      heads.set(step.id, fork);
      continue;
    }

    if (!heads.has(step.branch)) return fail("the branch does not exist yet");
    for (const t of step.tags) {
      const bad = gitLabelRejection(t);
      if (bad !== undefined) return fail(`tag: ${bad}`);
    }
    if (step.type !== "cherryPick" && step.name !== undefined) {
      const bad = gitLabelRejection(step.name);
      if (bad !== undefined) return fail(`commit id: ${bad}`);
      if (commitNames.has(step.name)) return fail(`commit id \`${step.name}\` is already used`);
      commitNames.add(step.name);
    }
    if (step.type === "commit" && step.message !== undefined) {
      const bad = gitLabelRejection(step.message);
      if (bad !== undefined) return fail(`message: ${bad}`);
    }

    const head = heads.get(step.branch);
    let parents: GitCommitId[];

    if (step.type === "commit") {
      parents = head !== undefined ? [head] : [];
    } else if (step.type === "merge") {
      if (!heads.has(step.from)) return fail("the branch to merge does not exist yet");
      const other = heads.get(step.from);
      // mermaid's order of checks, so a refusal reads the same
      if (head !== undefined && other !== undefined && byId.get(head)!.branch === step.from) {
        return fail(`cannot merge \`${nameOf(step.from)}\` into itself`);
      }
      if (step.branch === step.from) return fail("cannot merge a branch into itself");
      if (head === undefined) return fail(`\`${nameOf(step.branch)}\` has no commits to merge into`);
      if (other === undefined) return fail(`\`${nameOf(step.from)}\` has no commits to merge`);
      if (head === other) return fail("both branches have the same head");
      parents = [head, other];
    } else {
      const source = byId.get(step.source);
      if (source === undefined) return fail("cherry-pick source must be an earlier commit");
      if (source.step.type === "cherryPick") return fail("a cherry-pick has no id, so it cannot be cherry-picked");
      if (step.parent !== undefined) {
        const parent = byId.get(step.parent);
        if (!source.parents.includes(step.parent) || parent === undefined) {
          return fail("parent must be an immediate parent of the cherry-picked commit");
        }
        if (parent.step.type === "cherryPick") return fail("a cherry-pick has no id, so it cannot be named as a parent");
      } else if (source.step.type === "merge") {
        return fail("cherry-picking a merge commit needs a parent");
      }
      if (source.branch === step.branch) return fail("the commit is already on this branch");
      if (head === undefined) return fail(`\`${nameOf(step.branch)}\` has no commits`);
      parents = [head, source.step.id];
    }

    const commit: GitCommit = { step, index, seq: commits.length, branch: step.branch, parents };
    commits.push(commit);
    byId.set(step.id, commit);
    heads.set(step.branch, step.id);
  }

  const lanes = branches
    .map((b, i) => ({ id: b.id, key: b.order ?? 0, i }))
    .toSorted((a, b) => a.key - b.key || a.i - b.i)
    .map((b) => b.id);
  return { ok: true, commits, branches, lanes };
}

/** What is wrong with the script, or undefined when mermaid would run it. */
export function gitGraphProblem(ir: GitGraphIR): string | undefined {
  const r = resolveGitGraph(ir);
  return r.ok ? undefined : r.message;
}

export function gitBranchById(ir: GitGraphIR, id: GitBranchId): { id: GitBranchId; name: string } | undefined {
  if (id === GIT_MAIN_BRANCH) return { id, name: GIT_MAIN_NAME };
  const s = ir.steps.find((x): x is GitBranchStep => x.type === "branch" && x.id === id);
  return s && { id, name: s.name };
}

/** Names mermaid text must give commits that something refers to: the
 * explicit `id:` where there is one, else a minted `c<n>` that no other
 * commit uses. Only commits that a cherry-pick names are in the map. */
export function gitReferencedNames(ir: GitGraphIR): Map<GitCommitId, string> {
  const used = new Set<string>();
  for (const s of ir.steps) if (isGitCommitLike(s) && gitLabel(s) !== undefined) used.add(gitLabel(s)!);
  const wanted = new Set<GitCommitId>();
  for (const s of ir.steps) {
    if (s.type !== "cherryPick") continue;
    wanted.add(s.source);
    if (s.parent !== undefined) wanted.add(s.parent);
  }
  const out = new Map<GitCommitId, string>();
  let n = 0;
  for (const s of ir.steps) {
    if (!isGitCommitLike(s) || !wanted.has(s.id)) continue;
    const given = gitLabel(s);
    if (given !== undefined) {
      out.set(s.id, given);
      continue;
    }
    let name: string;
    do {
      n += 1;
      name = `c${n}`;
    } while (used.has(name));
    used.add(name);
    out.set(s.id, name);
  }
  return out;
}
