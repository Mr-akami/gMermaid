import type {
  EdgeId,
  FlowchartArrowType,
  FlowchartDirection,
  FlowchartEdge,
  FlowchartEndpoint,
  FlowchartIR,
  FlowchartNode,
  FlowchartNodeShape,
  FlowchartSubgraph,
  NodeId,
  SubgraphId,
} from "@gmermaid/ir";
import { unescapeLabel, unquote, type ParseError, type ParseResult } from "./common";

// Recognizes the flowchart subset gMermaid emits plus common hand-written
// variants (unquoted labels, bare node ids, `graph` keyword).

const ID = "[A-Za-z0-9_-]+";
const ID_RE = new RegExp(`^${ID}$`);

// shape brackets, longest-open-first so `(((` wins over `((` wins over `(`;
// same-open pairs (`[/…/]` vs `[/…\]`) are told apart by their closer
const SHAPES: readonly { open: string; close: string; shape: FlowchartNodeShape }[] = [
  { open: "(((", close: ")))", shape: "doubleCircle" },
  { open: "((", close: "))", shape: "circle" },
  { open: "([", close: "])", shape: "stadium" },
  { open: "[[", close: "]]", shape: "subroutine" },
  { open: "[(", close: ")]", shape: "cylinder" },
  { open: "[/", close: "\\]", shape: "trapezoid" },
  { open: "[/", close: "/]", shape: "parallelogram" },
  { open: "[\\", close: "/]", shape: "trapezoidAlt" },
  { open: "[\\", close: "\\]", shape: "parallelogramAlt" },
  { open: "{{", close: "}}", shape: "hexagon" },
  { open: "[", close: "]", shape: "rect" },
  { open: "(", close: ")", shape: "rounded" },
  { open: "{", close: "}", shape: "diamond" },
  { open: ">", close: "]", shape: "asymmetric" },
];

const ARROWS: readonly { token: string; arrow: FlowchartArrowType }[] = [
  { token: "-.->", arrow: "dotted" },
  { token: "==>", arrow: "thick" },
  { token: "-->", arrow: "arrow" },
  { token: "---", arrow: "open" },
  { token: "~~~", arrow: "invisible" },
];

// `A-- text -->B` inline labels normalize to the pipe form before tokenizing
const INLINE_LABELS: readonly { re: RegExp; token: string }[] = [
  { re: /-\.\s+(.+?)\s+\.->/g, token: "-.->" },
  { re: /==\s+(.+?)\s+==>/g, token: "==>" },
  { re: /--\s+(.+?)\s+-->/g, token: "-->" },
  { re: /--\s+(.+?)\s+---/g, token: "---" },
];

interface NodeRef {
  readonly id: string;
  readonly label?: string;
  readonly shape?: FlowchartNodeShape;
}

/** Parse `id`, `id["label"]`, `id(label)`, … Returns null if not a node term. */
function parseNodeTerm(term: string): NodeRef | null {
  const t = term.trim();
  const m = t.match(new RegExp(`^(${ID})(.*)$`));
  if (!m) return null;
  const id = m[1]!;
  const rest = m[2]!.trim();
  if (rest === "") return { id };
  for (const s of SHAPES) {
    if (rest.startsWith(s.open) && rest.endsWith(s.close) && rest.length >= s.open.length + s.close.length) {
      const inner = rest.slice(s.open.length, rest.length - s.close.length);
      return { id, label: unescapeLabel(unquote(inner)), shape: s.shape };
    }
  }
  return null;
}

/** Split `A & B["x & y"]` on top-level `&` only (never inside brackets/quotes). */
function splitTerms(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') inQuote = !inQuote;
    else if (!inQuote && "([{".includes(c)) depth += 1;
    else if (!inQuote && ")]}".includes(c)) depth -= 1;
    else if (!inQuote && depth === 0 && c === "&") {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

interface Link {
  readonly arrow: FlowchartArrowType;
  readonly label?: string;
}

/** Tokenize one line into node groups joined by links: supports chaining
 * (`A-->B-->C`) and `&` fan-out (`A & B --> C`). Returns null when the line
 * holds no arrow at all. */
function parseEdgeLine(line: string): { groups: NodeRef[][]; links: Link[] } | string | null {
  let text = line;
  for (const { re, token } of INLINE_LABELS) text = text.replaceAll(re, (_, label: string) => `${token}|${label}|`);

  const groups: NodeRef[][] = [];
  const links: Link[] = [];
  let rest = text;
  for (;;) {
    const hit = ARROWS.map((a) => ({ a, idx: rest.indexOf(a.token) }))
      .filter((x) => x.idx > 0)
      .toSorted((x, y) => x.idx - y.idx)[0];
    if (!hit) break;
    const left = rest.slice(0, hit.idx);
    rest = rest.slice(hit.idx + hit.a.token.length).trim();
    let label: string | undefined;
    if (rest.startsWith("|")) {
      const end = rest.indexOf("|", 1);
      if (end < 0) return "unterminated edge label `|...|`";
      label = unescapeLabel(unquote(rest.slice(1, end)));
      rest = rest.slice(end + 1).trim();
    }
    const terms = splitTerms(left).map(parseNodeTerm);
    if (terms.some((t) => t === null)) return "cannot parse edge endpoints";
    groups.push(terms as NodeRef[]);
    links.push({ arrow: hit.a.arrow, ...(label !== undefined ? { label } : {}) });
  }
  if (links.length === 0) return null;
  const terms = splitTerms(rest).map(parseNodeTerm);
  if (rest.trim() === "" || terms.some((t) => t === null)) return "cannot parse edge endpoints";
  groups.push(terms as NodeRef[]);
  return { groups, links };
}

export function parseFlowchart(code: string): ParseResult<FlowchartIR> {
  const errors: ParseError[] = [];
  const lines = code.split("\n");

  let direction: FlowchartDirection = "TB";
  let headerSeen = false;
  const nodes = new Map<string, FlowchartNode>();
  const nodeOrder: string[] = [];
  const edges: FlowchartEdge[] = [];
  const subgraphs = new Map<string, FlowchartSubgraph>();
  const subgraphOrder: string[] = [];
  let edgeSeq = 0;

  // subgraph nesting: declarations inside a block belong to it
  const stack: { id: SubgraphId; openedAt: number }[] = [];
  const currentParent = (): SubgraphId | undefined => stack[stack.length - 1]?.id;
  // ids only ever seen as bare edge endpoints: may turn out to be subgraphs
  const bareOnly = new Set<string>();

  const declare = (ref: NodeRef): void => {
    const existing = nodes.get(ref.id);
    if (!existing) {
      if (subgraphs.has(ref.id)) return; // an edge endpoint naming a subgraph
      nodeOrder.push(ref.id);
      const parent = currentParent();
      nodes.set(ref.id, {
        id: ref.id as NodeId,
        label: ref.label ?? ref.id,
        shape: ref.shape ?? "rect",
        ...(parent !== undefined ? { parent } : {}),
      });
      if (ref.label === undefined) bareOnly.add(ref.id);
      else bareOnly.delete(ref.id);
    } else if (ref.label !== undefined) {
      // a later decl with an explicit label/shape wins over a bare reference
      nodes.set(ref.id, { ...existing, label: ref.label, shape: ref.shape ?? existing.shape });
      bareOnly.delete(ref.id);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i]!.trim();
    if (line === "" || line.startsWith("%%")) continue;

    if (!headerSeen) {
      const h = line.match(/^(?:flowchart|graph)\s+(TB|TD|LR|BT|RL)\s*$/);
      if (!h) {
        errors.push({ line: lineNo, message: "expected `flowchart <TB|LR|BT|RL>` header" });
        return { ok: false, errors };
      }
      direction = h[1] === "TD" ? "TB" : (h[1] as FlowchartDirection);
      headerSeen = true;
      continue;
    }

    // subgraph id / subgraph id[title] … end (nested)
    const sub = line.match(new RegExp(`^subgraph\\s+(${ID})\\s*(?:\\[(.*)\\])?$`));
    if (sub) {
      const id = sub[1]!;
      if (nodes.has(id)) {
        if (!bareOnly.has(id)) {
          errors.push({ line: lineNo, message: `\`${id}\` is already a node` });
          continue;
        }
        // it was only ever a bare edge endpoint — that reference meant this
        // subgraph all along, not an implicit node
        nodes.delete(id);
        nodeOrder.splice(nodeOrder.indexOf(id), 1);
        bareOnly.delete(id);
      }
      if (!subgraphs.has(id)) {
        subgraphOrder.push(id);
        const parent = currentParent();
        subgraphs.set(id, {
          id: id as SubgraphId,
          label: sub[2] !== undefined ? unescapeLabel(unquote(sub[2])) : id,
          ...(parent !== undefined ? { parent } : {}),
        });
      }
      stack.push({ id: id as SubgraphId, openedAt: lineNo });
      continue;
    }

    if (line === "end") {
      if (stack.pop() === undefined) errors.push({ line: lineNo, message: "`end` without an open subgraph" });
      continue;
    }

    const dir = line.match(/^direction\s+(TB|TD|LR|BT|RL)$/);
    if (dir) {
      const top = stack[stack.length - 1];
      if (top === undefined) {
        errors.push({ line: lineNo, message: "`direction` is only valid inside a subgraph" });
        continue;
      }
      const d = (dir[1] === "TD" ? "TB" : dir[1]) as FlowchartDirection;
      subgraphs.set(top.id, { ...subgraphs.get(top.id)!, direction: d });
      continue;
    }

    // edge line: <terms> <arrow>[|label|] <terms> [<arrow> <terms> …]
    const parsed = parseEdgeLine(line);
    if (typeof parsed === "string") {
      errors.push({ line: lineNo, message: parsed });
      continue;
    }
    if (parsed) {
      let bad = false;
      for (let g = 0; g < parsed.links.length && !bad; g++) {
        for (const from of parsed.groups[g]!) {
          for (const to of parsed.groups[g + 1]!) {
            if (from.id === to.id) {
              errors.push({ line: lineNo, message: "self-loops are not supported" });
              bad = true;
              break;
            }
          }
          if (bad) break;
        }
      }
      if (bad) continue;
      for (const group of parsed.groups) for (const ref of group) declare(ref);
      for (let g = 0; g < parsed.links.length; g++) {
        const link = parsed.links[g]!;
        for (const from of parsed.groups[g]!) {
          for (const to of parsed.groups[g + 1]!) {
            edgeSeq += 1;
            edges.push({
              id: `edge-${edgeSeq}` as EdgeId,
              from: from.id as FlowchartEndpoint,
              to: to.id as FlowchartEndpoint,
              arrow: link.arrow,
              ...(link.label !== undefined ? { label: link.label } : {}),
            });
          }
        }
      }
      continue;
    }

    // node declaration line
    const ref = parseNodeTerm(line);
    if (ref && (ref.label !== undefined || ID_RE.test(line))) {
      declare(ref);
      continue;
    }

    errors.push({ line: lineNo, message: `cannot parse: ${line}` });
  }

  if (!headerSeen) errors.push({ line: 1, message: "empty diagram: missing header" });
  for (const open of stack) errors.push({ line: open.openedAt, message: `unclosed subgraph: ${open.id}` });
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    ir: {
      kind: "flowchart",
      direction,
      nodes: nodeOrder.map((id) => nodes.get(id)!),
      edges,
      subgraphs: subgraphOrder.map((id) => subgraphs.get(id)!),
    },
  };
}
