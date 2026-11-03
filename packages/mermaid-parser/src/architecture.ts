import {

  archNameRejection,
  settleArchitecture,
  type ArchEdge,
  type ArchEdgeId,
  type ArchGroup,
  type ArchGroupId,
  type ArchJunction,
  type ArchJunctionId,
  type ArchNodeId,
  type ArchService,
  type ArchServiceId,
  type ArchSide,
  type ArchitectureIR,
} from "@gmermaid/ir";
import { dropList, prepareLines, unescapeLabel, type ParseError, type ParseResult, type ParseWarning } from "./common";

// Dialect the IR cannot hold is DISCARDED by design, the same as `%%`
// comments: frontmatter and `%%{init}%%`, the shared styling / accessibility
// statements, `title`, and `align row|column …` layout hints (positions are
// the layout engine's, CONTEXT.md).
const DROPPED = dropList({ extra: ["title", "align"] });

const ID = "[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*";
const ICON = "\\(([\\w:-]+)\\)";
const TITLE = `\\[((?:"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|[^\\[\\]\\r\\n]+))\\]`;

/** Title text: one level of quotes off, `\"` unescaped, entities decoded. */
function readTitle(raw: string): string {
  let t = raw.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
    t = t.slice(1, -1).replaceAll(/\\(.)/g, "$1");
  }
  return unescapeLabel(t).trim();
}

const GROUP_RE = new RegExp(`^group\\s+(${ID})\\s*(?:${ICON})?\\s*(?:${TITLE})?\\s*(?:\\bin\\s+(${ID}))?$`);
const SERVICE_RE = new RegExp(`^service\\s+(${ID})\\s*(?:${ICON})?\\s*(?:${TITLE})?\\s*(?:\\bin\\s+(${ID}))?$`);
const JUNCTION_RE = new RegExp(`^junction\\s+(${ID})\\s*(?:\\bin\\s+(${ID}))?$`);
const EDGE_RE = new RegExp(
  `^(${ID})(\\{group\\})?:([LRTB])\\s*(<)?(?:--|-${TITLE}-)(>)?\\s*([LRTB]):(${ID})(\\{group\\})?$`,
);

interface Raw<T> {
  readonly rec: T;
  readonly line: number;
  readonly parent: string | undefined;
}

export function parseArchitecture(code: string): ParseResult<ArchitectureIR> {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  const lines = prepareLines(code, { drop: DROPPED, warnings });

  const groups: Raw<ArchGroup>[] = [];
  const services: Raw<ArchService>[] = [];
  const junctions: Raw<ArchJunction>[] = [];
  const edges: { m: RegExpMatchArray; line: number }[] = [];
  let headerSeen = false;

  const check = (name: string, line: number): boolean => {
    const bad = archNameRejection(name);
    if (bad !== undefined) {
      errors.push({ line, message: `\`${name}\`: ${bad}` });
      return false;
    }
    return true;
  };

  for (const { text: line, line: lineNo } of lines) {
    if (!headerSeen) {
      if (line !== "architecture-beta") {
        errors.push({ line: lineNo, message: "expected `architecture-beta` header" });
        return { ok: false, errors };
      }
      headerSeen = true;
      continue;
    }

    const g = line.match(GROUP_RE);
    if (g) {
      if (!check(g[1]!, lineNo)) continue;
      const label = g[3] !== undefined ? readTitle(g[3]) : undefined;
      groups.push({
        line: lineNo,
        parent: g[4],
        rec: {
          id: g[1]! as ArchGroupId,
          name: g[1]!,
          ...(label !== undefined && label !== "" ? { label } : {}),
          ...(g[2] !== undefined ? { icon: g[2] } : {}),
        },
      });
      continue;
    }

    const s = line.match(SERVICE_RE);
    if (s) {
      if (!check(s[1]!, lineNo)) continue;
      const label = s[3] !== undefined ? readTitle(s[3]) : undefined;
      services.push({
        line: lineNo,
        parent: s[4],
        rec: {
          id: s[1]! as ArchServiceId,
          name: s[1]!,
          ...(label !== undefined && label !== "" ? { label } : {}),
          ...(s[2] !== undefined ? { icon: s[2] } : {}),
        },
      });
      continue;
    }

    const j = line.match(JUNCTION_RE);
    if (j) {
      if (!check(j[1]!, lineNo)) continue;
      junctions.push({ line: lineNo, parent: j[2], rec: { id: j[1]! as ArchJunctionId, name: j[1]! } });
      continue;
    }

    const e = line.match(EDGE_RE);
    if (e) {
      edges.push({ m: e, line: lineNo });
      continue;
    }

    errors.push({ line: lineNo, message: `cannot parse: ${line}` });
  }

  if (!headerSeen) errors.push({ line: 1, message: "empty diagram: missing header" });

  // one namespace for all three, and parents must resolve to GROUPS
  const kindOf = new Map<string, "group" | "node">();
  const claim = (name: string, line: number, kind: "group" | "node"): void => {
    if (kindOf.has(name)) errors.push({ line, message: `the id \`${name}\` is already in use` });
    else kindOf.set(name, kind);
  };
  for (const x of groups) claim(x.rec.name, x.line, "group");
  for (const x of services) claim(x.rec.name, x.line, "node");
  for (const x of junctions) claim(x.rec.name, x.line, "node");

  const resolveParent = (name: string, parent: string | undefined, line: number, earlier?: ReadonlySet<string>): ArchGroupId | undefined => {
    if (parent === undefined) return undefined;
    if (parent === name) {
      errors.push({ line, message: `\`${name}\` cannot be placed within itself` });
      return undefined;
    }
    const kind = kindOf.get(parent);
    if (kind === undefined) errors.push({ line, message: `the parent \`${parent}\` of \`${name}\` does not exist` });
    else if (kind === "node") errors.push({ line, message: `the parent \`${parent}\` of \`${name}\` is not a group` });
    // mermaid registers a group's parent only if it is declared earlier
    else if (earlier !== undefined && !earlier.has(parent)) {
      errors.push({ line, message: `declare the parent group \`${parent}\` before \`${name}\`` });
    } else return parent as ArchGroupId;
    return undefined;
  };

  const seenGroups = new Set<string>();
  const outGroups: ArchGroup[] = groups.map((x) => {
    const parent = resolveParent(x.rec.name, x.parent, x.line, seenGroups);
    seenGroups.add(x.rec.name);
    return parent !== undefined ? { ...x.rec, parent } : x.rec;
  });
  const outServices: ArchService[] = services.map((x) => {
    const group = resolveParent(x.rec.name, x.parent, x.line);
    return group !== undefined ? { ...x.rec, group } : x.rec;
  });
  const outJunctions: ArchJunction[] = junctions.map((x) => {
    const group = resolveParent(x.rec.name, x.parent, x.line);
    return group !== undefined ? { ...x.rec, group } : x.rec;
  });

  const outEdges: ArchEdge[] = [];
  let edgeSeq = 0;
  for (const { m, line } of edges) {
    const from = m[1]!;
    const to = m[8]!;
    let ok = true;
    for (const end of [from, to]) {
      const kind = kindOf.get(end);
      if (kind === undefined) {
        errors.push({ line, message: `the id \`${end}\` does not exist yet — declare the service before an edge to it` });
        ok = false;
      } else if (kind === "group") {
        errors.push({ line, message: `\`${end}\` is a group — an edge ends on a service or junction; write \`member{group}\` to reach a group border` });
        ok = false;
      }
    }
    if (ok && from === to) {
      errors.push({ line, message: `an edge cannot connect \`${from}\` to itself` });
      ok = false;
    }
    if (!ok) continue;
    const title = m[5];
    const label = title !== undefined ? readTitle(title) : undefined;
    edgeSeq += 1;
    outEdges.push({
      id: `edge-${edgeSeq}` as ArchEdgeId,
      from: from as ArchNodeId,
      to: to as ArchNodeId,
      fromSide: m[3]! as ArchSide,
      toSide: m[7]! as ArchSide,
      arrowFrom: m[4] !== undefined,
      arrowTo: m[6] !== undefined,
      ...(m[2] !== undefined ? { groupFrom: true as const } : {}),
      ...(m[9] !== undefined ? { groupTo: true as const } : {}),
      ...(label !== undefined && label !== "" ? { label } : {}),
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  // a `{group}` flag mermaid would refuse (same group both ends) or that means
  // nothing (node outside every group) is settled away rather than kept
  const ir = settleArchitecture({ kind: "architecture", groups: outGroups, services: outServices, junctions: outJunctions, edges: outEdges });
  return { ok: true, warnings, ir };
}

