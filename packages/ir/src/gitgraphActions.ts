import type { GitBranchId, GitCommitId } from "./ids";
import {
  gitGraphProblem,
  isGitCommitLike,
  type GitBranchStep,
  type GitCommitLikeStep,
  type GitCommitType,
  type GitDirection,
  type GitGraphIR,
  type GitStep,
} from "./gitgraph";
import { omitUndefined } from "./omitUndefined";

// Same contract as the other diagram actions: intent-carrying, immutable,
// identity-preserving on no-ops. A git graph is a script mermaid RUNS, so
// every structural edit is applied and then checked by the simulator
// (`gitGraphProblem`): an edit that leaves a script mermaid would refuse is
// rejected, and `tryGitGraphAction` says why.

export interface GitCommitPatch {
  /** `null` clears. */
  readonly name?: string | null;
  readonly message?: string | null;
  readonly tags?: readonly string[];
  readonly commitType?: GitCommitType;
  /** cherry-pick only. `null` clears. */
  readonly parent?: GitCommitId | null;
  /** cherry-pick only. */
  readonly source?: GitCommitId;
}

export type GitGraphAction =
  | { type: "setDirection"; direction: GitDirection }
  /** Appended: a step added in the GUI happens last. */
  | { type: "addStep"; step: GitStep }
  | { type: "updateBranch"; id: GitBranchId; name?: string; /** `null` clears */ order?: number | null }
  | { type: "updateCommit"; id: GitCommitId; patch: GitCommitPatch }
  /** Later = +1. A commit passes the next commit (and any `branch` lines
   * between); a branch line swaps with its neighbour. */
  | { type: "moveStep"; id: string; delta: -1 | 1 }
  /** Takes everything that cannot exist without it: a branch's commits, the
   * merges of it, the branches forked from it, cherry-picks of its commits. */
  | { type: "removeStep"; id: string };

export type GitGraphActionResult =
  | { readonly ok: true; readonly ir: GitGraphIR }
  | { readonly ok: false; readonly reason: string };

function checked(next: GitGraphIR): GitGraphActionResult {
  const problem = gitGraphProblem(next);
  return problem === undefined ? { ok: true, ir: next } : { ok: false, reason: problem };
}

function removalClosure(steps: readonly GitStep[], id: string): Set<string> {
  const gone = new Set<string>([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const s of steps) {
      if (gone.has(s.id)) continue;
      const dependsOnGone =
        s.type === "branch"
          ? gone.has(s.from)
          : gone.has(s.branch) ||
            (s.type === "merge" && gone.has(s.from)) ||
            (s.type === "cherryPick" && (gone.has(s.source) || (s.parent !== undefined && gone.has(s.parent))));
      if (dependsOnGone) {
        gone.add(s.id);
        grew = true;
      }
    }
  }
  return gone;
}

function patchStep(step: GitCommitLikeStep, patch: GitCommitPatch): GitCommitLikeStep {
  const tags = patch.tags ?? step.tags;
  if (step.type === "commit") {
    return omitUndefined({
      ...step,
      name: patch.name === undefined ? step.name : (patch.name ?? undefined),
      message: patch.message === undefined ? step.message : (patch.message ?? undefined),
      tags,
      commitType: patch.commitType ?? step.commitType,
    });
  }
  if (step.type === "merge") {
    return omitUndefined({
      ...step,
      name: patch.name === undefined ? step.name : (patch.name ?? undefined),
      tags,
      commitType: patch.commitType ?? step.commitType,
    });
  }
  return omitUndefined({
    ...step,
    source: patch.source ?? step.source,
    parent: patch.parent === undefined ? step.parent : (patch.parent ?? undefined),
    tags,
  });
}

export function tryGitGraphAction(ir: GitGraphIR, action: GitGraphAction): GitGraphActionResult {
  const same: GitGraphActionResult = { ok: true, ir };
  switch (action.type) {
    case "setDirection":
      return action.direction === ir.direction ? same : { ok: true, ir: { ...ir, direction: action.direction } };

    case "addStep":
      return checked({ ...ir, steps: [...ir.steps, action.step] });

    case "updateBranch": {
      const s = ir.steps.find((x): x is GitBranchStep => x.type === "branch" && x.id === action.id);
      if (!s) return same;
      const name = action.name ?? s.name;
      const order = action.order === undefined ? s.order : (action.order ?? undefined);
      if (name === s.name && order === s.order) return same;
      const next = omitUndefined({ ...s, name, order }) as GitBranchStep;
      return checked({ ...ir, steps: ir.steps.map((x) => (x === s ? next : x)) });
    }

    case "updateCommit": {
      const s = ir.steps.find((x): x is GitCommitLikeStep => isGitCommitLike(x) && x.id === action.id);
      if (!s) return same;
      const next = patchStep(s, action.patch);
      if (JSON.stringify(next) === JSON.stringify(s)) return same;
      return checked({ ...ir, steps: ir.steps.map((x) => (x === s ? next : x)) });
    }

    case "moveStep": {
      const i = ir.steps.findIndex((s) => s.id === action.id);
      if (i < 0) return same;
      const step = ir.steps[i]!;
      let j = i + action.delta;
      if (j < 0 || j >= ir.steps.length) return same;
      // a commit steps over the next commit, `branch` lines included
      if (isGitCommitLike(step)) {
        while (!isGitCommitLike(ir.steps[j]!) && j + action.delta >= 0 && j + action.delta < ir.steps.length) j += action.delta;
      }
      const steps = [...ir.steps];
      steps.splice(i, 1);
      steps.splice(j, 0, step);
      return checked({ ...ir, steps });
    }

    case "removeStep": {
      if (!ir.steps.some((s) => s.id === action.id)) return same;
      const gone = removalClosure(ir.steps, action.id);
      return checked({ ...ir, steps: ir.steps.filter((s) => !gone.has(s.id)) });
    }
  }
}

export function applyGitGraphAction(ir: GitGraphIR, action: GitGraphAction): GitGraphIR {
  const r = tryGitGraphAction(ir, action);
  return r.ok ? r.ir : ir;
}
