import {
  ER_CARDINALITIES,
  ER_KEYS,
  ER_LEFT_GLYPH,
  ER_RIGHT_GLYPH,
  type AttributeId,
  type EntityId,
  type ErAttribute,
  type ErCardinality,
  type ErEntity,
  type ErIR,
  type ErKey,
  type ErRelationship,
  type RelationId,
} from "@gmermaid/ir";
import { dropList, prepareLines, unescapeLabel, unquote, type ParseError, type ParseResult, type ParseWarning } from "./common";

// Styling has no IR here, so the shared styling statements and `:::class`
// suffixes are dropped on import (lossy by design, like `%%`, but reported).
const DROPPED = dropList();

// mermaid's name rule: bare word, or anything in double quotes.
const NAME = '(?:"[^"]*"|[A-Za-z0-9_][A-Za-z0-9_-]*)';
const ALIAS = '(?:\\[\\s*("[^"]*")\\s*\\])?';

const reverse = (glyphs: Record<ErCardinality, string>): Map<string, ErCardinality> =>
  new Map(ER_CARDINALITIES.map((c) => [glyphs[c], c]));
const LEFT = reverse(ER_LEFT_GLYPH);
const RIGHT = reverse(ER_RIGHT_GLYPH);

const alt = (glyphs: Record<ErCardinality, string>): string =>
  [...new Set(ER_CARDINALITIES.map((c) => glyphs[c]))].map((g) => g.replaceAll(/[|{}]/g, "\\$&")).join("|");

const RELATIONSHIP = new RegExp(
  `^(${NAME})\\s*(${alt(ER_LEFT_GLYPH)})(--|\\.\\.)(${alt(ER_RIGHT_GLYPH)})\\s*(${NAME})\\s*(?::\\s*(.*))?$`,
);
const ENTITY_BLOCK = new RegExp(`^(${NAME})${ALIAS}\\s*\\{\\s*(\\})?$`);
const ENTITY_BARE = new RegExp(`^(${NAME})${ALIAS}$`);
// type name [PK, FK, UK] ["comment"]
const ATTRIBUTE = /^(\S+)\s+(\*?[^\s"]+)((?:\s+(?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*)*)(?:\s+("[^"]*"))?$/;

const readText = (raw: string): string => unescapeLabel(unquote(raw));

export function parseErDiagram(code: string): ParseResult<ErIR> {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  const lines = prepareLines(code, { drop: DROPPED, stripClassSuffix: true, warnings });

  const entities: ErEntity[] = [];
  const relationships: ErRelationship[] = [];
  const byName = new Map<string, number>();
  let attrSeq = 0;
  let relSeq = 0;
  let headerSeen = false;
  let direction: ErIR["direction"];
  let open: { name: string; line: number } | null = null;

  /** Index of the entity called `name`, declaring it on first sight. */
  const entity = (name: string): number => {
    const known = byName.get(name);
    if (known !== undefined) return known;
    entities.push({ id: name as EntityId, name, attributes: [] });
    byName.set(name, entities.length - 1);
    return entities.length - 1;
  };
  const patch = (i: number, f: (e: ErEntity) => ErEntity) => {
    entities[i] = f(entities[i]!);
  };

  for (const { text: line, line: lineNo } of lines) {
    if (!headerSeen) {
      if (line !== "erDiagram") {
        errors.push({ line: lineNo, message: "expected `erDiagram` header" });
        return { ok: false, errors };
      }
      headerSeen = true;
      continue;
    }

    if (open !== null) {
      if (line === "}") {
        open = null;
        continue;
      }
      const m = ATTRIBUTE.exec(line);
      if (!m) {
        errors.push({ line: lineNo, message: `cannot parse attribute: ${line}` });
        continue;
      }
      const keys = [...m[3]!.matchAll(/PK|FK|UK/g)].map((k) => k[0] as ErKey).filter((k, i, all) => ER_KEYS.includes(k) && all.indexOf(k) === i);
      const attribute: ErAttribute = {
        id: `attribute-${++attrSeq}` as AttributeId,
        type: m[1]!,
        name: m[2]!,
        keys,
        ...(m[4] !== undefined ? { comment: readText(m[4]) } : {}),
      };
      const i = byName.get(open.name)!;
      patch(i, (e) => ({ ...e, attributes: [...e.attributes, attribute] }));
      continue;
    }

    const dir = line.match(/^direction\s+(TB|LR|BT|RL)$/);
    if (dir) {
      direction = dir[1] as NonNullable<ErIR["direction"]>;
      continue;
    }

    const rel = RELATIONSHIP.exec(line);
    if (rel) {
      const from = entity(readText(rel[1]!));
      const to = entity(readText(rel[5]!));
      const label = rel[6] === undefined ? undefined : readText(rel[6].trim());
      relSeq += 1;
      relationships.push({
        id: `relation-${relSeq}` as RelationId,
        from: entities[from]!.id,
        to: entities[to]!.id,
        fromCard: LEFT.get(rel[2]!)!,
        toCard: RIGHT.get(rel[4]!)!,
        identifying: rel[3] === "--",
        ...(label !== undefined && label !== "" ? { label } : {}),
      });
      continue;
    }

    const block = ENTITY_BLOCK.exec(line);
    const bare = block ? null : ENTITY_BARE.exec(line);
    const decl = block ?? bare;
    if (decl) {
      const name = readText(decl[1]!);
      const i = entity(name);
      if (decl[2] !== undefined) {
        const alias = readText(decl[2]);
        patch(i, (e) => ({ ...e, alias }));
      }
      // `A { }` opens and closes on one line
      if (block && block[3] === undefined) open = { name, line: lineNo };
      continue;
    }

    errors.push({ line: lineNo, message: `cannot parse: ${line}` });
  }

  if (open !== null) errors.push({ line: open.line, message: `unclosed entity block: ${open.name}` });
  if (!headerSeen) errors.push({ line: 1, message: "empty diagram: missing header" });
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    warnings,
    ir: { kind: "er", ...(direction !== undefined ? { direction } : {}), entities, relationships },
  };
}
