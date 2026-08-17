import type {
  EdgeId,
  FlowchartArrowType,
  FlowchartDirection,
  FlowchartEdge,
  FlowchartIR,
  FlowchartNode,
  FlowchartNodeShape,
  NodeId,
} from "@gmermaid/ir";
import { unescapeLabel, unquote, type ParseError, type ParseResult } from "./common";

// Recognizes the flowchart subset gMermaid emits plus common hand-written
// variants (unquoted labels, bare node ids, `graph` keyword).

const ID = "[A-Za-z0-9_-]+";
const ID_RE = new RegExp(`^${ID}$`);

// shape brackets, longest-first so `((` wins over `(`
const SHAPES: readonly { open: string; close: string; shape: FlowchartNodeShape }[] = [
  { open: "((", close: "))", shape: "circle" },
  { open: "([", close: "])", shape: "stadium" },
  { open: "[", close: "]", shape: "rect" },
  { open: "(", close: ")", shape: "rounded" },
  { open: "{", close: "}", shape: "diamond" },
];

const ARROWS: readonly { token: string; arrow: FlowchartArrowType }[] = [
  { token: "-.->", arrow: "dotted" },
  { token: "==>", arrow: "thick" },
  { token: "-->", arrow: "arrow" },
  { token: "---", arrow: "open" },
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
    if (rest.startsWith(s.open) && rest.endsWith(s.close)) {
      const inner = rest.slice(s.open.length, rest.length - s.close.length);
      return { id, label: unescapeLabel(unquote(inner)), shape: s.shape };
    }
  }
  return null;
}

export function parseFlowchart(code: string): ParseResult<FlowchartIR> {
  const errors: ParseError[] = [];
  const lines = code.split("\n");

  let direction: FlowchartDirection = "TB";
  let headerSeen = false;
  const nodes = new Map<string, FlowchartNode>();
  const nodeOrder: string[] = [];
  const edges: FlowchartEdge[] = [];
  let edgeSeq = 0;

  const declare = (ref: NodeRef): void => {
    const existing = nodes.get(ref.id);
    if (!existing) {
      nodeOrder.push(ref.id);
      nodes.set(ref.id, {
        id: ref.id as NodeId,
        label: ref.label ?? ref.id,
        shape: ref.shape ?? "rect",
      });
    } else if (ref.label !== undefined) {
      // a later decl with an explicit label/shape wins over a bare reference
      nodes.set(ref.id, { ...existing, label: ref.label, shape: ref.shape ?? existing.shape });
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

    // edge line: <term> <arrow>[|label|] <term>
    const arrowHit = ARROWS.map((a) => ({ a, idx: line.indexOf(a.token) }))
      .filter((x) => x.idx > 0)
      .toSorted((x, y) => x.idx - y.idx)[0];

    if (arrowHit) {
      const { a, idx } = arrowHit;
      const left = line.slice(0, idx);
      let rest = line.slice(idx + a.token.length).trim();
      let label: string | undefined;
      if (rest.startsWith("|")) {
        const end = rest.indexOf("|", 1);
        if (end < 0) {
          errors.push({ line: lineNo, message: "unterminated edge label `|...|`" });
          continue;
        }
        label = unescapeLabel(unquote(rest.slice(1, end)));
        rest = rest.slice(end + 1).trim();
      }
      const from = parseNodeTerm(left);
      const to = parseNodeTerm(rest);
      if (!from || !to) {
        errors.push({ line: lineNo, message: "cannot parse edge endpoints" });
        continue;
      }
      if (from.id === to.id) {
        errors.push({ line: lineNo, message: "self-loops are not supported" });
        continue;
      }
      declare(from);
      declare(to);
      edgeSeq += 1;
      edges.push({
        id: `edge-${edgeSeq}` as EdgeId,
        from: from.id as NodeId,
        to: to.id as NodeId,
        arrow: a.arrow,
        ...(label !== undefined ? { label } : {}),
      });
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
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    ir: {
      kind: "flowchart",
      direction,
      nodes: nodeOrder.map((id) => nodes.get(id)!),
      edges,
    },
  };
}
