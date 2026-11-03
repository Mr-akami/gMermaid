import {
  GIT_MAIN_BRANCH,
  GIT_MAIN_NAME,
  gitBranchRef,
  gitQuote,
  gitReferencedNames,
  type GitBranchId,
  type GitCommitType,
  type GitGraphIR,
} from "@gmermaid/ir";

// Canonical form: the script with the implicit "current branch" made
// explicit by `checkout` lines, emitted only where the branch changes. The
// IR keeps no `checkout` of its own, so a round trip normalizes them.
// Mermaid's strings have no escape; the IR only holds text that can be
// quoted one way or the other (`gitTextRejection`).

const typeOpt = (t: GitCommitType): string => (t === "NORMAL" ? "" : ` type: ${t}`);
const tagOpts = (tags: readonly string[]): string => tags.map((t) => ` tag: ${gitQuote(t)}`).join("");

export function gitGraphToMermaid(ir: GitGraphIR): string {
  const lines = [ir.direction === "LR" ? "gitGraph" : `gitGraph ${ir.direction}:`];
  const names = new Map<GitBranchId, string>([[GIT_MAIN_BRANCH, GIT_MAIN_NAME]]);
  for (const s of ir.steps) if (s.type === "branch") names.set(s.id, s.name);
  // a commit a cherry-pick refers to must be spelled with an `id:`
  const refs = gitReferencedNames(ir);
  const ref = (id: string): string => refs.get(id as never) ?? id;

  let current: GitBranchId = GIT_MAIN_BRANCH;
  const switchTo = (id: GitBranchId): void => {
    if (id === current) return;
    lines.push(`  checkout ${gitBranchRef(names.get(id) ?? id)}`);
    current = id;
  };

  for (const s of ir.steps) {
    switch (s.type) {
      case "branch":
        switchTo(s.from);
        lines.push(`  branch ${gitBranchRef(s.name)}${s.order !== undefined ? ` order: ${s.order}` : ""}`);
        current = s.id;
        break;
      case "commit": {
        switchTo(s.branch);
        const name = refs.get(s.id) ?? s.name;
        const id = name !== undefined ? ` id: ${gitQuote(name)}` : "";
        const msg = s.message !== undefined ? ` msg: ${gitQuote(s.message)}` : "";
        lines.push(`  commit${id}${msg}${tagOpts(s.tags)}${typeOpt(s.commitType)}`);
        break;
      }
      case "merge": {
        switchTo(s.branch);
        const name = refs.get(s.id) ?? s.name;
        const id = name !== undefined ? ` id: ${gitQuote(name)}` : "";
        lines.push(`  merge ${gitBranchRef(names.get(s.from) ?? s.from)}${id}${tagOpts(s.tags)}${typeOpt(s.commitType)}`);
        break;
      }
      case "cherryPick": {
        switchTo(s.branch);
        const parent = s.parent !== undefined ? ` parent: ${gitQuote(ref(s.parent))}` : "";
        lines.push(`  cherry-pick id: ${gitQuote(ref(s.source))}${parent}${tagOpts(s.tags)}`);
        break;
      }
    }
  }
  return lines.join("\n") + "\n";
}
