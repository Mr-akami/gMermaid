import type {
  ClassIR,
  ClassId,
  ClassMember,
  ClassMethod,
  ClassNamespace,
  ClassNode,
  ClassNote,
  ClassRelation,
  NamespaceId,
  NoteId,
  RelationHead,
  RelationId,
  Visibility,
} from "@gmermaid/ir";
import { dropList, prepareLines, unescapeLabel, type ParseError, type ParseResult, type ParseWarning } from "./common";

// Dialect the IR cannot hold is DISCARDED by design, same as `%%` comments:
// frontmatter, `%%{init}%%` directives, the shared styling statements plus
// `callback` / `link` / `title`, trailing `;`, and `:::className` suffixes.
// (`class` itself is a declaration here — kept, unlike every other kind.)
// Also lossy: the `*` (abstract) classifier on an ATTRIBUTE — UML has no
// abstract field and the IR only keeps `abstract` on methods.

const DROPPED = dropList({ extra: ["callback", "link", "title"], keep: ["class"] });

// Plain names are what mermaid tokenizes as an identifier; anything else
// (spaces, `-`, punctuation) travels in backticks. `-` is accepted bare only
// where no relation token can follow (declarations).
const PLAIN = "[\\p{L}\\p{N}_.]+";
const PLAIN_DECL = "[\\p{L}\\p{N}_.-]+";
const NAME = `(?:\`[^\`]+\`|${PLAIN})`;
const NAME_DECL = `(?:\`[^\`]+\`|${PLAIN_DECL})`;
// generic param may nest (`List~List~int~~`): closing `~` is the one followed by a delimiter
const GENERIC = "(?:~(.*?)~(?=\\s|$|\\[|\\{|<<))";
const MEMBER_NAME = "[A-Za-z_][A-Za-z0-9_]*";

const unwrap = (name: string): string => (name.startsWith("`") ? name.slice(1, -1) : name);

const VIS: Record<string, Visibility> = {
  "+": "public",
  "-": "private",
  "#": "protected",
  "~": "package",
};

const HEAD_FROM: Record<string, RelationHead> = { "<|": "inheritance", "<": "arrow", "*": "composition", o: "aggregation", "()": "lollipop" };
const HEAD_TO: Record<string, RelationHead> = { "|>": "inheritance", ">": "arrow", "*": "composition", o: "aggregation", "()": "lollipop" };
const REL_TOKEN = "(<\\||<|\\*|o|\\(\\))?(--|\\.\\.)(\\|>|>|\\*|o|\\(\\))?";

/**
 * One member in either of mermaid's dialects: `+name : Type` / `+Type name`
 * for attributes, `+run(p) : T` / `+run(p) T` for methods, with an optional
 * `$` (static) / `*` (abstract) classifier after `)` or at the very end.
 */
export function parseMemberLine(line: string): { attribute?: ClassMember; method?: ClassMethod } | null {
  const head = line.match(/^([+\-#~]?)\s*(.*)$/);
  if (!head) return null;
  const visibility = VIS[head[1] ?? ""] ?? "public";
  let body = head[2]!.trim();
  if (body === "") return null;

  const method = body.match(new RegExp(`^(${MEMBER_NAME})\\s*\\(([^)]*)\\)\\s*([$*])?\\s*(?::\\s*)?(.*)$`));
  if (method) {
    let classifier = method[3];
    let type = method[4]!.trim();
    if (classifier === undefined && /[$*]$/.test(type)) {
      classifier = type.slice(-1);
      type = type.slice(0, -1).trim();
    }
    return {
      method: {
        name: method[1]!,
        visibility,
        params: method[2]!.trim(),
        ...(type !== "" ? { type } : {}),
        ...(classifier === "*" ? { abstract: true } : {}),
        ...(classifier === "$" ? { static: true } : {}),
      },
    };
  }

  const isStatic = body.endsWith("$");
  if (/[$*]$/.test(body)) body = body.slice(0, -1).trim();
  const flags = isStatic ? { static: true } : {};
  const colon = body.match(new RegExp(`^(${MEMBER_NAME})\\s*:\\s*(.+)$`));
  if (colon) return { attribute: { name: colon[1]!, visibility, type: colon[2]!.trim(), ...flags } };
  const typeFirst = body.match(new RegExp(`^(.+?)\\s+(${MEMBER_NAME})$`));
  if (typeFirst) return { attribute: { name: typeFirst[2]!, visibility, type: typeFirst[1]!.trim(), ...flags } };
  if (new RegExp(`^${MEMBER_NAME}$`).test(body)) return { attribute: { name: body, visibility, ...flags } };
  return null;
}

export function parseClassDiagram(code: string): ParseResult<ClassIR> {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  const lines = prepareLines(code, { drop: DROPPED, stripClassSuffix: true, warnings });

  const classes = new Map<string, ClassNode>();
  const order: string[] = [];
  const relations: ClassRelation[] = [];
  const notes: ClassNote[] = [];
  const namespaces: ClassNamespace[] = [];
  let relSeq = 0;
  let noteSeq = 0;
  let headerSeen = false;
  let openClass: string | null = null;
  let openNamespace: string | null = null;
  let direction: ClassIR["direction"];

  const declare = (raw: string): string => {
    const name = unwrap(raw);
    const existing = classes.get(name);
    if (!existing) {
      order.push(name);
      classes.set(name, {
        id: name as ClassId,
        name,
        stereotypes: [],
        attributes: [],
        methods: [],
        ...(openNamespace !== null ? { namespace: openNamespace as NamespaceId } : {}),
      });
    } else if (openNamespace !== null && existing.namespace === undefined) {
      // a class first seen in a relation, later declared inside a namespace
      classes.set(name, { ...existing, namespace: openNamespace as NamespaceId });
    }
    return name;
  };
  const update = (name: string, patch: (c: ClassNode) => ClassNode): void => {
    classes.set(name, patch(classes.get(name)!));
  };
  const addMember = (name: string, text: string, lineNo: number): void => {
    const member = parseMemberLine(text);
    if (!member) {
      errors.push({ line: lineNo, message: `cannot parse member: ${text}` });
      return;
    }
    update(name, (c) => ({
      ...c,
      attributes: member.attribute ? [...c.attributes, member.attribute] : c.attributes,
      methods: member.method ? [...c.methods, member.method] : c.methods,
    }));
  };
  const addStereotypes = (name: string, list: string): void => {
    const found = [...list.matchAll(/<<(.+?)>>/g)].map((m) => m[1]!.trim());
    update(name, (c) => ({ ...c, stereotypes: [...c.stereotypes, ...found] }));
  };

  for (const { text: line, line: lineNo } of lines) {
    if (!headerSeen) {
      if (line !== "classDiagram" && line !== "classDiagram-v2") {
        errors.push({ line: lineNo, message: "expected `classDiagram` header" });
        return { ok: false, errors };
      }
      headerSeen = true;
      continue;
    }

    if (openClass !== null) {
      if (line === "}") {
        openClass = null;
        continue;
      }
      if (/^(<<.+?>>\s*)+$/.test(line)) {
        addStereotypes(openClass, line);
        continue;
      }
      addMember(openClass, line, lineNo);
      continue;
    }

    if (line === "}" && openNamespace !== null) {
      openNamespace = null;
      continue;
    }

    // class Name~G~["label"] <<anno>> {
    const decl = line.match(new RegExp(`^class\\s+(${NAME_DECL})${GENERIC}?\\s*(?:\\["([^"]*)"\\])?\\s*((?:<<.+?>>\\s*)*)(\\{)?$`, "u"));
    if (decl) {
      const name = declare(decl[1]!);
      if (decl[2] !== undefined) update(name, (c) => ({ ...c, generic: decl[2]! }));
      if (decl[3] !== undefined) update(name, (c) => ({ ...c, label: unescapeLabel(decl[3]!) }));
      if (decl[4] !== "") addStereotypes(name, decl[4]!);
      if (decl[5] !== undefined) openClass = name;
      continue;
    }

    const ns = line.match(new RegExp(`^namespace\\s+(${NAME_DECL})\\s*\\{$`, "u"));
    if (ns) {
      if (openNamespace !== null) {
        errors.push({ line: lineNo, message: "nested namespaces are not supported" });
        continue;
      }
      const name = unwrap(ns[1]!);
      if (!namespaces.some((n) => n.name === name)) namespaces.push({ id: name as NamespaceId, name });
      openNamespace = name;
      continue;
    }

    const dir = line.match(/^direction\s+(TB|TD|LR|BT|RL)$/);
    if (dir) {
      direction = (dir[1] === "TD" ? "TB" : dir[1]) as NonNullable<ClassIR["direction"]>;
      continue;
    }

    // one-line annotation: `<<interface>> ClassName`
    const anno = line.match(new RegExp(`^(<<.+?>>)\\s+(${NAME})${GENERIC}?$`, "u"));
    if (anno) {
      const name = declare(anno[2]!);
      if (anno[3] !== undefined) update(name, (c) => ({ ...c, generic: anno[3]! }));
      addStereotypes(name, anno[1]!);
      continue;
    }

    const note = line.match(new RegExp(`^note\\s+(?:for\\s+(${NAME})\\s+)?"([^"]*)"$`, "u"));
    if (note) {
      noteSeq += 1;
      const target = note[1] !== undefined ? declare(note[1]) : undefined;
      notes.push({
        id: `note-${noteSeq}` as NoteId,
        text: unescapeLabel(note[2]!),
        ...(target !== undefined ? { target: target as ClassId } : {}),
      });
      continue;
    }

    // inline member: `ClassName : +member` (colon syntax)
    const inline = line.match(new RegExp(`^(${NAME})${GENERIC}?\\s*:\\s*(.+)$`, "u"));
    if (inline) {
      const name = declare(inline[1]!);
      addMember(name, inline[3]!.trim(), lineNo);
      continue;
    }

    // relation: From ["card"] token ["card"] To [: label]
    const rel = line.match(
      new RegExp(
        `^(${NAME})${GENERIC}?\\s*(?:"([^"]*)")?\\s*${REL_TOKEN}\\s*(?:"([^"]*)")?\\s*(${NAME})${GENERIC}?\\s*(?::\\s*(.+))?$`,
        "u",
      ),
    );
    if (rel) {
      const [, fromRaw, , fromCard, headFromTok, lineTok, headToTok, toCard, toRaw, , label] = rel;
      const from = declare(fromRaw!);
      const to = declare(toRaw!);
      relSeq += 1;
      relations.push({
        id: `relation-${relSeq}` as RelationId,
        from: from as ClassId,
        to: to as ClassId,
        line: lineTok === "--" ? "solid" : "dashed",
        headFrom: headFromTok !== undefined ? HEAD_FROM[headFromTok]! : "none",
        headTo: headToTok !== undefined ? HEAD_TO[headToTok]! : "none",
        ...(label !== undefined ? { label: unescapeLabel(label.trim()) } : {}),
        ...(fromCard !== undefined ? { fromCardinality: unescapeLabel(fromCard) } : {}),
        ...(toCard !== undefined ? { toCardinality: unescapeLabel(toCard) } : {}),
      });
      continue;
    }

    errors.push({ line: lineNo, message: `cannot parse: ${line}` });
  }

  const lastLine = lines[lines.length - 1]?.line ?? 1;
  if (openClass !== null) errors.push({ line: lastLine, message: `unclosed class block: ${openClass}` });
  if (openNamespace !== null) errors.push({ line: lastLine, message: `unclosed namespace block: ${openNamespace}` });
  if (!headerSeen) errors.push({ line: 1, message: "empty diagram: missing header" });
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    warnings,
    ir: {
      kind: "class",
      ...(direction !== undefined ? { direction } : {}),
      classes: order.map((n) => classes.get(n)!),
      relations,
      notes,
      namespaces,
    },
  };
}
