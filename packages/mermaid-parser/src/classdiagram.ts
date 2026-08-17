import type {
  ClassIR,
  ClassId,
  ClassMember,
  ClassMethod,
  ClassNode,
  ClassRelation,
  RelationId,
  RelationType,
  Visibility,
} from "@gmermaid/ir";
import type { ParseError, ParseResult } from "./common";

const NAME = "[A-Za-z_][A-Za-z0-9_]*";

const VIS: Record<string, Visibility> = {
  "+": "public",
  "-": "private",
  "#": "protected",
  "~": "package",
};

// longest-first (the regex alternation below must match this order)
const REL_TOKENS: readonly { token: string; type: RelationType }[] = [
  { token: "--|>", type: "inheritance" },
  { token: "..|>", type: "realization" },
  { token: "--*", type: "composition" },
  { token: "--o", type: "aggregation" },
  { token: "-->", type: "association" },
  { token: "..>", type: "dependency" },
  { token: "--", type: "linkSolid" },
  { token: "..", type: "linkDashed" },
];
const REL_ALTERNATION = "--\\|>|\\.\\.\\|>|--\\*|--o|-->|\\.\\.>|--|\\.\\.";

export function parseMemberLine(line: string): { attribute?: ClassMember; method?: ClassMethod } | null {
  const m = line.match(new RegExp(`^([+\\-#~]?)\\s*(${NAME})\\s*(\\(([^)]*)\\))?\\s*(?::\\s*(.+)|\\s(.+))?$`));
  if (!m) return null;
  const visibility = VIS[m[1] ?? ""] ?? "public";
  const name = m[2]!;
  if (m[3] !== undefined) {
    // methods accept both return-type dialects: `+run() : T` and mermaid's `+run() T`
    const type = (m[5] ?? m[6])?.trim();
    return { method: { name, visibility, params: (m[4] ?? "").trim(), ...(type !== undefined ? { type } : {}) } };
  }
  // attributes keep the colon form only — a bare `a b` is mermaid's
  // type-first attribute (`String name`), which this grammar does not model
  if (m[6] !== undefined) return null;
  const type = m[5]?.trim();
  return { attribute: { name, visibility, ...(type !== undefined ? { type } : {}) } };
}

export function parseClassDiagram(code: string): ParseResult<ClassIR> {
  const errors: ParseError[] = [];
  const lines = code.split("\n");

  const classes = new Map<string, ClassNode>();
  const order: string[] = [];
  const relations: ClassRelation[] = [];
  let relSeq = 0;
  let headerSeen = false;
  let openClass: string | null = null;
  let direction: ClassIR["direction"];

  const declare = (name: string): void => {
    if (classes.has(name)) return;
    order.push(name);
    classes.set(name, { id: name as ClassId, name, attributes: [], methods: [] });
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i]!.trim();
    if (line === "" || line.startsWith("%%")) continue;

    if (!headerSeen) {
      if (line !== "classDiagram") {
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
      const st = line.match(/^<<(.+)>>$/);
      const cls = classes.get(openClass)!;
      if (st) {
        classes.set(openClass, { ...cls, stereotype: st[1]!.trim() });
        continue;
      }
      const member = parseMemberLine(line);
      if (!member) {
        errors.push({ line: lineNo, message: `cannot parse member: ${line}` });
        continue;
      }
      classes.set(openClass, {
        ...cls,
        attributes: member.attribute ? [...cls.attributes, member.attribute] : cls.attributes,
        methods: member.method ? [...cls.methods, member.method] : cls.methods,
      });
      continue;
    }

    const decl = line.match(new RegExp(`^class\\s+(${NAME})\\s*(\\{)?$`));
    if (decl) {
      declare(decl[1]!);
      if (decl[2] !== undefined) openClass = decl[1]!;
      continue;
    }

    const dir = line.match(/^direction\s+(TB|LR|BT|RL)$/);
    if (dir) {
      direction = dir[1] as NonNullable<ClassIR["direction"]>;
      continue;
    }

    // one-line annotation: `<<interface>> ClassName`
    const anno = line.match(new RegExp(`^<<(.+)>>\\s+(${NAME})$`));
    if (anno) {
      declare(anno[2]!);
      const cls = classes.get(anno[2]!)!;
      classes.set(anno[2]!, { ...cls, stereotype: anno[1]!.trim() });
      continue;
    }

    // inline member: `ClassName : +member` (colon syntax)
    const inline = line.match(new RegExp(`^(${NAME})\\s*:\\s*(.+)$`));
    if (inline) {
      declare(inline[1]!);
      const member = parseMemberLine(inline[2]!.trim());
      if (!member) {
        errors.push({ line: lineNo, message: `cannot parse member: ${inline[2]!}` });
        continue;
      }
      const cls = classes.get(inline[1]!)!;
      classes.set(inline[1]!, {
        ...cls,
        attributes: member.attribute ? [...cls.attributes, member.attribute] : cls.attributes,
        methods: member.method ? [...cls.methods, member.method] : cls.methods,
      });
      continue;
    }

    // relation: From ["card"] token ["card"] To [: label]
    const rel = line.match(
      new RegExp(`^(${NAME})\\s*(?:"([^"]*)")?\\s*(${REL_ALTERNATION})\\s*(?:"([^"]*)")?\\s*(${NAME})\\s*(?::\\s*(.+))?$`),
    );
    if (rel) {
      const type = REL_TOKENS.find((t) => t.token === rel[3])!.type;
      declare(rel[1]!);
      declare(rel[5]!);
      relSeq += 1;
      relations.push({
        id: `relation-${relSeq}` as RelationId,
        from: rel[1]! as ClassId,
        to: rel[5]! as ClassId,
        type,
        ...(rel[6] !== undefined ? { label: rel[6].trim() } : {}),
        ...(rel[2] !== undefined ? { fromCardinality: rel[2] } : {}),
        ...(rel[4] !== undefined ? { toCardinality: rel[4] } : {}),
      });
      continue;
    }

    errors.push({ line: lineNo, message: `cannot parse: ${line}` });
  }

  if (openClass !== null) errors.push({ line: lines.length, message: `unclosed class block: ${openClass}` });
  if (!headerSeen) errors.push({ line: 1, message: "empty diagram: missing header" });
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    ir: {
      kind: "class",
      ...(direction !== undefined ? { direction } : {}),
      classes: order.map((n) => classes.get(n)!),
      relations,
    },
  };
}
