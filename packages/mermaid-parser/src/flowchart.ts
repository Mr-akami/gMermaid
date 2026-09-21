import {
  flowchartShapeFromMermaid,
  normalizeFlowchartEdge,
  type EdgeId,
  type FlowchartDirection,
  type FlowchartEdge,
  type FlowchartEdgeHead,
  type FlowchartEndpoint,
  type FlowchartIR,
  type FlowchartLineStyle,
  type FlowchartNode,
  type FlowchartNodeShape,
  type FlowchartSubgraph,
  type NodeId,
  type SubgraphId,
} from "@gmermaid/ir";
import { prepareLines, unescapeLabel, unquote, type ParseError, type ParseResult } from "./common";

// Recognizes the flowchart subset gMermaid emits plus common hand-written
// variants (unquoted labels, bare node ids, `graph` keyword, `;` separators,
// bare `flowchart` header = TB). Dialect the IR cannot hold is DISCARDED by
// design, same as `%%` comments: frontmatter, `%%{init}%%` directives,
// `style` / `classDef` / `class` / `linkStyle` / `click` statements,
// `accTitle` / `accDescr`, and `:::className` suffixes on nodes.

const DROPPED = ["style", "classDef", "class", "linkStyle", "click", "accTitle", "accDescr"];

// mermaid ids may hold any letter/digit (incl. non-ASCII), `_`, `-` and `.`
const ID = "[\\p{L}\\p{N}_.-]+";
const ID_RE = new RegExp(`^${ID}$`, "u");
const ID_CHAR_RE = /[\p{L}\p{N}_.-]/u;

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

interface NodeRef {
  readonly id: string;
  readonly label?: string;
  readonly shape?: FlowchartNodeShape;
}

/** Split `shape: x, label: "a, b"` on commas outside quotes. */
function splitAttrs(text: string): string[] {
  const parts: string[] = [];
  let inQuote = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') inQuote = !inQuote;
    else if (!inQuote && c === ",") {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

/** `id@{ shape: doc, label: "x" }`. Unknown keys (icon, pos, …) are dropped
 * like styling: the IR has nowhere to keep them. */
function parseAttrs(id: string, body: string): NodeRef | string {
  let label: string | undefined;
  let shape: FlowchartNodeShape | undefined;
  for (const attr of splitAttrs(body)) {
    const m = attr.match(/^([A-Za-z_]+)\s*:\s*([\s\S]*)$/);
    if (!m) return `cannot parse node attribute \`${attr}\``;
    const value = unquote(m[2]!);
    if (m[1] === "shape") {
      shape = flowchartShapeFromMermaid(value);
      if (shape === undefined) return `unknown shape \`${value}\``;
    } else if (m[1] === "label") {
      label = unescapeLabel(value);
    }
  }
  return { id, ...(label !== undefined ? { label } : {}), ...(shape !== undefined ? { shape } : {}) };
}

/** Parse `id`, `id["label"]`, `id(label)`, `id@{ shape: doc }`, … Returns
 * null when the term is not a node at all, a message when it is malformed. */
function parseNodeTerm(term: string): NodeRef | string | null {
  const t = term.trim();
  const m = t.match(new RegExp(`^(${ID})([\\s\\S]*)$`, "u"));
  if (!m) return null;
  const id = m[1]!;
  const rest = m[2]!.trim();
  if (rest === "") return { id };
  if (rest.startsWith("@{") && rest.endsWith("}")) return parseAttrs(id, rest.slice(2, -1));
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
  readonly line: FlowchartLineStyle;
  readonly headStart: FlowchartEdgeHead;
  readonly headEnd: FlowchartEdgeHead;
  readonly length?: number;
  readonly label?: string;
}

// Link tokens, as mermaid's lexer sees them. A whole token (`<-.->`, `o--x`,
// `~~~~`) …
const PLAIN_LINK = /^[<ox]?(?:-{2,}[-xo>]|-\.+-[xo>]?|={2,}[=xo>]|~{3,})/;
// … or the two halves around an inline label (`o-- txt --o`).
const START_LINK = /^[<ox]?(?:--|-\.|==)/;
const END_LINK = /^(?:-{2,}[-xo>]|\.+-[xo>]?|={2,}[=xo>])/;

interface EndInfo {
  readonly line: FlowchartLineStyle;
  readonly head: FlowchartEdgeHead;
  readonly doubled: boolean;
  readonly length: number;
}

/** mermaid's destructEndLink: the token's LAST char is the head, the rest is
 * the line, and its length (minus the char the head would have taken) is the
 * rank span — dotted counts its dots instead. */
function destructEnd(token: string): EndInfo {
  const last = token.slice(-1);
  let body = token.slice(0, -1);
  let head: FlowchartEdgeHead = "none";
  let doubled = false;
  if (last === ">" || last === "x" || last === "o") {
    head = last === ">" ? "arrow" : last === "x" ? "cross" : "circle";
    const startChar = last === ">" ? "<" : last;
    if (token.startsWith(startChar)) {
      doubled = true;
      body = body.slice(1);
    }
  }
  let line: FlowchartLineStyle = "solid";
  if (body.startsWith("=")) line = "thick";
  if (body.startsWith("~")) line = "invisible";
  let length = body.length - 1;
  const dots = body.length - body.replaceAll(".", "").length;
  if (dots > 0) {
    line = "dotted";
    length = dots;
  }
  return { line, head, doubled, length: Math.max(1, length) };
}

function linkOf(info: EndInfo, headStart: FlowchartEdgeHead): Link {
  return {
    line: info.line,
    headStart,
    headEnd: info.head,
    ...(info.length > 1 ? { length: info.length } : {}),
  };
}

/** Index of the first `END_LINK` match after an inline label, or -1. */
function findEnd(text: string, from: number): { at: number; token: string } | null {
  for (let i = from; i < text.length; i++) {
    const m = text.slice(i).match(END_LINK);
    if (m) return { at: i, token: m[0] };
  }
  return null;
}

interface LinkMatch extends Link {
  /** index just past the token (and its inline label) */
  readonly end: number;
}

/** A link token starting exactly at `i`, or null. */
function matchLink(text: string, i: number): LinkMatch | null {
  const rest = text.slice(i);
  // a leading `o`/`x` glued to an id char belongs to the id (`Ao--oB` starts
  // at node `Ao`) — mermaid's lexer tokenizes the id first
  const glued = "ox".includes(text[i]!) && ID_CHAR_RE.test(text[i - 1] ?? " ");
  if (!glued) {
    const plain = rest.match(PLAIN_LINK);
    if (plain) {
      const info = destructEnd(plain[0]);
      return { ...linkOf(info, info.doubled ? info.head : "none"), end: i + plain[0].length };
    }
  }
  const start = glued ? null : rest.match(START_LINK);
  if (!start) return null;
  const labelFrom = i + start[0].length;
  const close = findEnd(text, labelFrom);
  if (!close) return null;
  const label = text.slice(labelFrom, close.at).trim();
  if (label === "") return null;
  const info = destructEnd(close.token);
  const startHead: FlowchartEdgeHead =
    start[0][0] === "<" ? "arrow" : start[0][0] === "o" ? "circle" : start[0][0] === "x" ? "cross" : "none";
  // mermaid calls a mismatched pair (`o-- t ---`, `-- t ==>`) INVALID; we stay
  // lenient and keep the end half, dropping the start head
  const headStart = startHead !== "none" && startHead === info.head ? startHead : "none";
  return { ...linkOf(info, headStart), label: unescapeLabel(label), end: close.at + close.token.length };
}

/** First link token at bracket depth 0 outside quotes, at or after `from`. */
function findLink(text: string, from: number): { at: number; link: LinkMatch } | null {
  let depth = 0;
  let inQuote = false;
  for (let i = from; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') inQuote = !inQuote;
    else if (!inQuote && "([{".includes(c)) depth += 1;
    // clamp: `A>"odd"]` closes a bracket it never opened
    else if (!inQuote && ")]}".includes(c)) depth = Math.max(0, depth - 1);
    else if (!inQuote && depth === 0 && i > 0 && "<ox-=~".includes(c)) {
      const link = matchLink(text, i);
      if (link) return { at: i, link };
    }
  }
  return null;
}

/** Tokenize one line into node groups joined by links: supports chaining
 * (`A-->B-->C`) and `&` fan-out (`A & B --> C`). Returns null when the line
 * holds no link at all, a message when the line is a malformed edge. */
function parseEdgeLine(line: string): { groups: NodeRef[][]; links: Link[] } | string | null {
  const groups: NodeRef[][] = [];
  const links: Link[] = [];
  let pos = 0;

  const takeGroup = (text: string): string | null => {
    const terms = splitTerms(text).map(parseNodeTerm);
    const bad = terms.find((t) => typeof t === "string");
    if (typeof bad === "string") return bad;
    if (text.trim() === "" || terms.some((t) => t === null)) return "cannot parse edge endpoints";
    groups.push(terms as NodeRef[]);
    return null;
  };

  for (;;) {
    const hit = findLink(line, pos);
    if (!hit) break;
    const { end, label: inlineLabel, ...link } = hit.link;
    let next = end;
    let label = inlineLabel;
    // `|text|` right after the token wins over an inline label
    const pipe = line.slice(next).match(/^\s*\|/);
    if (pipe) {
      const open = next + pipe[0].length;
      const close = line.indexOf("|", open);
      if (close < 0) return "unterminated edge label `|...|`";
      label = unescapeLabel(unquote(line.slice(open, close)));
      next = close + 1;
    }
    const err = takeGroup(line.slice(pos, hit.at));
    if (err) return err;
    links.push({ ...link, ...(label !== undefined ? { label } : {}) });
    pos = next;
  }
  if (links.length === 0) return null;
  const err = takeGroup(line.slice(pos));
  if (err) return err;
  return { groups, links };
}

export function parseFlowchart(code: string): ParseResult<FlowchartIR> {
  const errors: ParseError[] = [];
  const lines = prepareLines(code, { drop: DROPPED, splitSemicolons: true, stripClassSuffix: true });

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
    const explicit = ref.label !== undefined || ref.shape !== undefined;
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
      if (explicit) bareOnly.delete(ref.id);
      else bareOnly.add(ref.id);
    } else if (explicit) {
      // a later decl with an explicit label/shape wins over a bare reference
      nodes.set(ref.id, { ...existing, label: ref.label ?? existing.label, shape: ref.shape ?? existing.shape });
      bareOnly.delete(ref.id);
    }
  };

  for (const { text: line, line: lineNo } of lines) {
    if (!headerSeen) {
      // direction is optional (mermaid defaults to TB); `TD` is an alias of TB
      const h = line.match(/^(?:flowchart|graph)(?:\s+(TB|TD|LR|BT|RL))?$/);
      if (!h) {
        errors.push({ line: lineNo, message: "expected `flowchart <TB|LR|BT|RL>` header" });
        return { ok: false, errors };
      }
      direction = h[1] === undefined || h[1] === "TD" ? "TB" : (h[1] as FlowchartDirection);
      headerSeen = true;
      continue;
    }

    // `subgraph id`, `subgraph id[title]`, or the id-less `subgraph Title` /
    // `subgraph "Title"` — the latter get a synthesized mermaid-safe id
    // (mermaid itself names them `subGraph0`, …), so the title survives our
    // id-keyed IR and codegen.
    const head = line.match(/^subgraph\s+(.+)$/);
    if (head) {
      const withId = line.match(new RegExp(`^subgraph\\s+(${ID})\\s*(?:\\[(.*)\\])?$`, "u"));
      let id: string;
      let title: string | undefined;
      if (withId) {
        id = withId[1]!;
        title = withId[2];
      } else {
        title = head[1]!;
        let n = 0;
        while (subgraphs.has(`subGraph${n}`) || nodes.has(`subGraph${n}`)) n += 1;
        id = `subGraph${n}`;
      }
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
          label: title !== undefined ? unescapeLabel(unquote(title)) : id,
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

    // edge line: <terms> <link>[|label|] <terms> [<link> <terms> …]
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
            // an imported diagram cannot introduce a head pair mermaid has
            // no token for either: same invariant, same normalizer
            edges.push(
              normalizeFlowchartEdge({
                id: `edge-${edgeSeq}` as EdgeId,
                from: from.id as FlowchartEndpoint,
                to: to.id as FlowchartEndpoint,
                line: link.line,
                headStart: link.headStart,
                headEnd: link.headEnd,
                ...(link.length !== undefined ? { length: link.length } : {}),
                ...(link.label !== undefined ? { label: link.label } : {}),
              }),
            );
          }
        }
      }
      continue;
    }

    // node declaration line
    const ref = parseNodeTerm(line);
    if (typeof ref === "string") {
      errors.push({ line: lineNo, message: ref });
      continue;
    }
    if (ref && (ref.label !== undefined || ref.shape !== undefined || ID_RE.test(line))) {
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
