import type { MindmapIR, MindmapNode, MindmapNodeId, MindmapShape } from "@gmermaid/ir";
import { dropList, prepareLines, unescapeLabel, unquote, type ParseError, type ParseResult, type ParseWarning } from "./common";

// mindmap: an indented outline, one node per line. Hierarchy comes from the
// INDENTATION, not from any edge syntax — mermaid's rule is "a node is the
// child of the nearest previous node with a smaller indentation", which also
// covers outlines whose indentation is uneven (docs: "Unclear indentation").
// `::icon(…)` and `:::a b` lines attach to the node written above them.
// Dialect the IR cannot hold is DISCARDED by design, same as `%%` comments:
// frontmatter, `%%{init}%%` directives, trailing `;` and the shared styling
// statements. `class` is NOT dropped here: mindmap has no `class` statement,
// and node labels are free prose (`class diagram`) — see dropList.
//
// prepareLines trims every line, so indentation is read back from the
// original source by line number (it never splits a mindmap line — `;` is
// not a mindmap separator, so line numbers stay 1:1).

const DROPPED = dropList({ keep: ["class"] });

/** Shape delimiters, longest/most specific first: `((x))` must win over
 * `(x)`, and `))x((` over both. Group 1 = id (may be empty), group 2 = text. */
const SHAPES: readonly (readonly [MindmapShape, RegExp])[] = [
  ["bang", /^(.*?)\)\)([\s\S]*)\(\($/],
  ["circle", /^(.*?)\(\(([\s\S]*)\)\)$/],
  ["hexagon", /^(.*?)\{\{([\s\S]*)\}\}$/],
  ["square", /^(.*?)\[([\s\S]*)\]$/],
  ["rounded", /^(.*?)\(([\s\S]*)\)$/],
  ["cloud", /^(.*?)\)([\s\S]*)\($/],
];

/** Inverse of codegen's escapeBare: the default shape is written as bare
 * text, so brackets travel as numeric entities there. Decoded BEFORE
 * unescapeLabel, which is what turns `#35;` back into a literal `#`. */
const BARE_ENTITIES: readonly (readonly [RegExp, string])[] = [
  [/#40;/g, "("],
  [/#41;/g, ")"],
  [/#91;/g, "["],
  [/#93;/g, "]"],
  [/#123;/g, "{"],
  [/#125;/g, "}"],
];

function unescapeMindmap(text: string): string {
  let out = text;
  for (const [re, char] of BARE_ENTITIES) out = out.replaceAll(re, char);
  return unescapeLabel(out);
}

const ICON_RE = /^::icon\(\s*(.*?)\s*\)$/;
/** A `:::a b` line (or suffix): classes run to the end of the line. */
const CLASS_RE = /:::\s*([^:]*)$/;

/** A tab is worth 4 columns — mermaid compares indentation, never its units. */
function indentOf(raw: string): number {
  let n = 0;
  for (const c of raw) {
    if (c === " ") n += 1;
    else if (c === "\t") n += 4;
    else break;
  }
  return n;
}

interface NodeForm {
  readonly id: string | undefined;
  readonly label: string;
  readonly shape: MindmapShape;
}

/** Split `id[text]` / `id((text))` / … / bare text into id, label and shape. */
function nodeForm(text: string): NodeForm {
  for (const [shape, re] of SHAPES) {
    const m = text.match(re);
    if (m) {
      const id = m[1]!.trim();
      return { id: id === "" ? undefined : id, label: unescapeMindmap(unquote(m[2]!)), shape };
    }
  }
  // bare text: mermaid uses the text itself as the node id, so there is no
  // separate id to keep — one is minted instead
  return { id: undefined, label: unescapeMindmap(unquote(text)), shape: "default" };
}

export function parseMindmap(code: string): ParseResult<MindmapIR> {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  const lines = prepareLines(code, { drop: DROPPED, warnings });
  const source = code.split("\n");

  const nodes: MindmapNode[] = [];
  // open ancestors, innermost last: the parent of a new node is the deepest
  // entry with a strictly smaller indentation
  const stack: { indent: number; id: MindmapNodeId }[] = [];
  let headerSeen = false;

  // ids must never collide with ids written further down the document, so
  // the explicit ones are collected before any is minted
  const taken = new Set<string>();
  for (const { text } of lines) {
    if (ICON_RE.test(text) || text.startsWith(":::")) continue;
    const id = nodeForm(text.replace(CLASS_RE, "").trim()).id;
    if (id !== undefined) taken.add(id);
  }
  let seq = 0;
  const mintId = (): MindmapNodeId => {
    let id = "";
    do {
      seq += 1;
      id = `mindmap-${seq}`;
    } while (taken.has(id));
    taken.add(id);
    return id as MindmapNodeId;
  };

  for (const { text, line: lineNo } of lines) {
    if (!headerSeen) {
      if (text !== "mindmap") {
        errors.push({ line: lineNo, message: "expected `mindmap` header" });
        return { ok: false, errors };
      }
      headerSeen = true;
      continue;
    }

    const last = nodes[nodes.length - 1];

    const icon = text.match(ICON_RE);
    if (icon) {
      if (!last) {
        errors.push({ line: lineNo, message: "`::icon(…)` before any node" });
        continue;
      }
      nodes[nodes.length - 1] = { ...last, icon: icon[1]! };
      continue;
    }

    // `:::a b` on its own line decorates the node above; as a suffix it
    // decorates the node on the same line (mermaid only accepts the first
    // form, but importing the second loses nothing)
    const classMatch = text.match(CLASS_RE);
    const classes = classMatch ? classMatch[1]!.trim().split(/\s+/).filter((c) => c !== "") : undefined;
    const rest = classMatch ? text.slice(0, text.length - classMatch[0].length).trim() : text;

    if (rest === "") {
      if (!last) {
        errors.push({ line: lineNo, message: "`:::` class line before any node" });
        continue;
      }
      if (classes !== undefined && classes.length > 0) nodes[nodes.length - 1] = { ...last, classes };
      continue;
    }

    const indent = indentOf(source[lineNo - 1] ?? "");
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop();

    const form = nodeForm(rest);
    const parent = stack[stack.length - 1]?.id;
    if (parent === undefined && nodes.length > 0) {
      errors.push({ line: lineNo, message: `there can be only one root ("${form.label}" has no parent)` });
      continue;
    }
    const id = (form.id ?? mintId()) as MindmapNodeId;
    if (nodes.some((n) => n.id === id)) {
      errors.push({ line: lineNo, message: `duplicate node id: ${id}` });
      continue;
    }
    nodes.push({
      id,
      label: form.label,
      shape: form.shape,
      ...(classes !== undefined && classes.length > 0 ? { classes } : {}),
      ...(parent !== undefined ? { parent } : {}),
    });
    stack.push({ indent, id });
  }

  if (!headerSeen) errors.push({ line: 1, message: "empty diagram: missing header" });
  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, warnings, ir: { kind: "mindmap", nodes } };
}
