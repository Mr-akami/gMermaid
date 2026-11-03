import {
  GIT_COMMIT_TYPES,
  GIT_KEYWORDS,
  GIT_MAIN_BRANCH,
  GIT_MAIN_NAME,
  resolveGitGraph,
  type GitBranchId,
  type GitCommitId,
  type GitCommitType,
  type GitDirection,
  type GitGraphIR,
  type GitStep,
} from "@gmermaid/ir";
import { dropList, prepareLines, type ParseError, type ParseResult, type ParseWarning } from "./common";

// gitGraph: a script of `commit`, `branch`, `checkout`/`switch`, `merge` and
// `cherry-pick` lines run against a "current branch". The IR drops that
// implicit state (every step names its branch) and the script is replayed by
// `resolveGitGraph`, the same simulator the reducer uses, so a script mermaid
// would refuse is refused here with the line that broke it.
//
// Dropped by design, with a warning: `title`, `accTitle`/`accDescr` and the
// shared styling statements. Frontmatter / `%%{init}%%` config (themes,
// `mainBranchName`, `showBranches`, …) is skipped like everywhere else.

const DROPPED = dropList({ extra: ["title"] });

const HEADER_RE = /^gitGraph(?:(?:\s+(LR|TB|BT))?\s*:)?$/;

/** A quoted string, a `key:` label, or a bare word. Mermaid's labels are
 * glued to their value or spaced from it, so `id:"a"` and `id: "a"` read
 * the same. */
const TOKEN_RE = /"[^"]*"|'[^']*'|(?:id|msg|tag|type|order|parent):|[^\s"']+/g;

const BARE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_./-]*$/;

const isQuoted = (t: string): boolean => t.startsWith('"') || t.startsWith("'");
const unquote = (t: string): string => (isQuoted(t) ? t.slice(1, -1) : t);

interface Opts {
  id?: string;
  message?: string;
  tags: string[];
  type?: GitCommitType;
  order?: number;
  parent?: string;
  /** a bare string right after `commit` (`commit "message"`) */
  bare?: string;
}

/** `key: value` pairs after the keyword. `allowed` limits the keys a
 * statement takes; anything else is an error naming the offending token. */
function readOptions(tokens: readonly string[], allowed: readonly string[], allowBare: boolean): Opts | string {
  const o: Opts = { tags: [] };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (isQuoted(t) && allowBare && o.bare === undefined) {
      o.bare = unquote(t);
      continue;
    }
    if (!t.endsWith(":") || !allowed.includes(t.slice(0, -1))) return `unexpected \`${t}\``;
    const key = t.slice(0, -1);
    const value = tokens[i + 1];
    if (value === undefined) return `\`${t}\` needs a value`;
    i += 1;
    if (key === "type") {
      if (!GIT_COMMIT_TYPES.includes(value as GitCommitType)) return `type must be ${GIT_COMMIT_TYPES.join(", ")}`;
      o.type = value as GitCommitType;
    } else if (key === "order") {
      if (!/^\d+$/.test(value)) return "`order:` needs a whole number";
      o.order = Number(value);
    } else {
      if (!isQuoted(value)) return `\`${t}\` needs a quoted string`;
      const text = unquote(value);
      if (key === "tag") {
        if (text !== "") o.tags.push(text);
      } else if (key === "id") o.id = text;
      else if (key === "msg") o.message = text;
      else o.parent = text;
    }
  }
  return o;
}

export function parseGitGraph(code: string): ParseResult<GitGraphIR> {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  const lines = prepareLines(code, { drop: DROPPED, warnings });

  const steps: GitStep[] = [];
  const stepLine: number[] = [];
  let direction: GitDirection = "LR";
  let headerSeen = false;

  const branches = new Map<string, GitBranchId>([[GIT_MAIN_NAME, GIT_MAIN_BRANCH]]);
  const commitByName = new Map<string, GitCommitId>();
  let current: GitBranchId = GIT_MAIN_BRANCH;
  let branchSeq = 0;
  let commitSeq = 0;

  for (const { text: line, line: lineNo } of lines) {
    const fail = (message: string): void => {
      errors.push({ line: lineNo, message });
    };

    if (!headerSeen) {
      const m = HEADER_RE.exec(line);
      if (!m) {
        fail("expected `gitGraph` header (an orientation needs its colon: `gitGraph LR:`)");
        return { ok: false, errors };
      }
      if (m[1] !== undefined) direction = m[1] as GitDirection;
      headerSeen = true;
      continue;
    }

    const tokens = line.match(TOKEN_RE) ?? [];
    if (line.replace(TOKEN_RE, "").trim() !== "") {
      fail(`cannot parse: ${line} (unterminated string?)`);
      continue;
    }
    const keyword = tokens[0]!;
    const rest = tokens.slice(1);

    /** a branch operand: quoted, or one bare word that is no keyword */
    const branchName = (): string | undefined => {
      const t = rest[0];
      if (t === undefined) {
        fail(`\`${keyword}\` needs a branch name`);
        return undefined;
      }
      if (isQuoted(t)) return unquote(t);
      if (!BARE_NAME_RE.test(t) || GIT_KEYWORDS.has(t)) {
        fail(`\`${t}\` cannot be a bare branch name; put it in quotes`);
        return undefined;
      }
      return t;
    };
    const known = (name: string): GitBranchId | undefined => {
      const id = branches.get(name);
      if (id === undefined) fail(`branch \`${name}\` does not exist (create it with \`branch ${name}\`)`);
      return id;
    };
    const opts = (allowed: readonly string[], from: number, bare = false): Opts | undefined => {
      const r = readOptions(rest.slice(from), allowed, bare);
      if (typeof r === "string") {
        fail(r);
        return undefined;
      }
      return r;
    };
    const named = (name: string | undefined, what: string): GitCommitId | undefined | null => {
      if (name === undefined) return undefined;
      const id = commitByName.get(name);
      if (id === undefined) {
        fail(`no ${what} with id \`${name}\``);
        return null;
      }
      return id;
    };
    const push = (step: GitStep): void => {
      steps.push(step);
      stepLine.push(lineNo);
    };

    switch (keyword) {
      case "commit": {
        const o = opts(["id", "msg", "tag", "type"], 0, true);
        if (!o) break;
        commitSeq += 1;
        const id = `commit-${commitSeq}` as GitCommitId;
        const name = o.id === "" ? undefined : o.id;
        const message = o.message ?? o.bare;
        if (name !== undefined) commitByName.set(name, id);
        push({
          type: "commit",
          id,
          branch: current,
          ...(name !== undefined ? { name } : {}),
          ...(message !== undefined && message !== "" ? { message } : {}),
          tags: o.tags,
          commitType: o.type ?? "NORMAL",
        });
        break;
      }
      case "branch": {
        const name = branchName();
        if (name === undefined) break;
        if (branches.has(name)) {
          fail(`branch \`${name}\` already exists (use \`checkout ${name}\`)`);
          break;
        }
        const o = opts(["order"], 1);
        if (!o) break;
        branchSeq += 1;
        const id = `branch-${branchSeq}` as GitBranchId;
        push({ type: "branch", id, name, from: current, ...(o.order !== undefined ? { order: o.order } : {}) });
        branches.set(name, id);
        current = id;
        break;
      }
      case "checkout":
      case "switch": {
        const name = branchName();
        if (name === undefined) break;
        if (rest.length > 1) {
          fail(`unexpected \`${rest[1]}\``);
          break;
        }
        const id = known(name);
        if (id !== undefined) current = id;
        break;
      }
      case "merge": {
        const name = branchName();
        if (name === undefined) break;
        const from = known(name);
        const o = opts(["id", "tag", "type"], 1);
        if (from === undefined || !o) break;
        commitSeq += 1;
        const id = `commit-${commitSeq}` as GitCommitId;
        const cname = o.id === "" ? undefined : o.id;
        if (cname !== undefined) commitByName.set(cname, id);
        push({
          type: "merge",
          id,
          branch: current,
          from,
          ...(cname !== undefined ? { name: cname } : {}),
          tags: o.tags,
          commitType: o.type ?? "NORMAL",
        });
        break;
      }
      case "cherry-pick": {
        const o = opts(["id", "tag", "parent"], 0);
        if (!o) break;
        if (o.id === undefined || o.id === "") {
          fail("`cherry-pick` needs `id: \"…\"`, the commit to pick");
          break;
        }
        const source = named(o.id, "commit");
        const parent = named(o.parent, "parent commit");
        if (source == null || parent === null) break;
        commitSeq += 1;
        push({
          type: "cherryPick",
          id: `commit-${commitSeq}` as GitCommitId,
          branch: current,
          source,
          ...(parent !== undefined ? { parent } : {}),
          tags: o.tags,
        });
        break;
      }
      default:
        fail(`cannot parse: ${line}`);
    }
  }

  if (!headerSeen) errors.push({ line: 1, message: "empty diagram: missing header" });
  if (errors.length > 0) return { ok: false, errors };

  const ir: GitGraphIR = { kind: "gitGraph", direction, steps };
  // replay: the script has to RUN, or mermaid would refuse it
  const run = resolveGitGraph(ir);
  if (!run.ok) return { ok: false, errors: [{ line: stepLine[run.index] ?? 1, message: run.message }] };
  return { ok: true, warnings, ir };
}
