import type { GitBranchId, GitCommitId, GitCommitLikeStep, GitGraphIR, GitStep } from "@gmermaid/ir";
import { GIT_MAIN_BRANCH, gitGraphProblem, isGitCommitLike, newId, resolveGitGraph } from "@gmermaid/ir";
import type { KindClipboard, MergeResult } from "./kind";
import { saturate, uniqueName } from "./kind";

/**
 * Closure: a git graph is a script, so a slice has to be a script that
 * still RUNS. A selected commit pulls the `branch` line that makes its
 * branch (and the chain of branches that one forked from); a merge also
 * pulls the head of each side — the commits it joins — and a cherry-pick
 * its source and parent. A selected branch pulls its whole lane. A closure
 * that mermaid would still refuse (a merge into a branch with nothing on it
 * in the slice, say) is the one selection answered with `undefined`.
 */
function slice(ir: GitGraphIR, ids: ReadonlySet<string>): GitGraphIR | undefined {
  const run = resolveGitGraph(ir);
  if (!run.ok) return undefined;
  const byId = new Map<string, GitStep>(ir.steps.map((s) => [s.id, s] as const));
  const parentsOf = new Map(run.commits.map((c) => [c.step.id as string, c.parents] as const));

  const seed: string[] = [];
  for (const s of ir.steps) {
    if (ids.has(s.id)) seed.push(s.id);
    // a branch pulls every commit made on it
    if (isGitCommitLike(s) && ids.has(s.branch)) seed.push(s.id);
  }

  const kept = saturate(seed, (have) => {
    const more: string[] = [];
    for (const id of have) {
      const s = byId.get(id);
      if (!s) continue;
      if (s.type === "branch") {
        if (s.from !== GIT_MAIN_BRANCH) more.push(s.from);
        continue;
      }
      if (s.branch !== GIT_MAIN_BRANCH) more.push(s.branch);
      if (s.type === "merge") {
        if (s.from !== GIT_MAIN_BRANCH) more.push(s.from);
        more.push(...(parentsOf.get(id) ?? []));
      } else if (s.type === "cherryPick") {
        more.push(s.source, ...(parentsOf.get(id)?.slice(0, 1) ?? []));
        if (s.parent !== undefined) more.push(s.parent);
      }
    }
    return more;
  });

  const steps = ir.steps.filter((s) => kept.has(s.id));
  if (steps.length === 0) return undefined;
  const sliced: GitGraphIR = { kind: "gitGraph", direction: "LR", steps };
  return gitGraphProblem(sliced) === undefined ? sliced : undefined;
}

/**
 * Pasted steps run AFTER everything already there — a paste has no anchor,
 * and a git graph's only free axis is "later". The incoming main branch is
 * the target's main (mermaid has exactly one); every other branch is fresh,
 * and names that must stay unique (branch names, commit `id:`s) take the
 * first free `_2`, `_3`, …
 */
function merge(ir: GitGraphIR, inc: GitGraphIR): MergeResult<GitGraphIR> {
  const branchNames = new Set<string>(["main"]);
  const commitNames = new Set<string>();
  for (const s of ir.steps) {
    if (s.type === "branch") branchNames.add(s.name);
    else if (s.type !== "cherryPick" && s.name !== undefined) commitNames.add(s.name);
  }

  const branchMap = new Map<string, GitBranchId>([[GIT_MAIN_BRANCH, GIT_MAIN_BRANCH]]);
  const commitMap = new Map<string, GitCommitId>();
  const added: string[] = [];
  const b = (id: GitBranchId): GitBranchId => branchMap.get(id) ?? id;
  const c = (id: GitCommitId): GitCommitId => commitMap.get(id) ?? id;

  const pasted: GitStep[] = [];
  for (const s of inc.steps) {
    if (s.type === "branch") {
      const id = newId("gitBranch");
      branchMap.set(s.id, id);
      added.push(id);
      pasted.push({ ...s, id, name: uniqueName(s.name, branchNames), from: b(s.from) });
      continue;
    }
    const id = newId("gitCommit");
    commitMap.set(s.id, id);
    added.push(id);
    let next: GitCommitLikeStep;
    if (s.type === "commit") {
      next = { ...s, id, branch: b(s.branch), ...(s.name !== undefined ? { name: uniqueName(s.name, commitNames) } : {}) };
    } else if (s.type === "merge") {
      next = { ...s, id, branch: b(s.branch), from: b(s.from), ...(s.name !== undefined ? { name: uniqueName(s.name, commitNames) } : {}) };
    } else {
      next = { ...s, id, branch: b(s.branch), source: c(s.source), ...(s.parent !== undefined ? { parent: c(s.parent) } : {}) };
    }
    pasted.push(next);
  }

  if (pasted.length === 0) return { reason: "nothing in the clipboard could be pasted here" };
  const merged: GitGraphIR = { ...ir, steps: [...ir.steps, ...pasted] };
  const problem = gitGraphProblem(merged);
  if (problem !== undefined) return { reason: `the paste does not fit after this history: ${problem}` };
  return { ir: merged, added };
}

export const gitGraphClipboard: KindClipboard<GitGraphIR> = { slice, merge };
