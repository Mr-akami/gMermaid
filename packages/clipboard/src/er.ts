import type { EntityId, ErEntity, ErIR, ErRelationship } from "@gmermaid/ir";
import { ER_NAME_RE, newId, omitUndefined } from "@gmermaid/ir";
import type { KindClipboard, MergeResult } from "./kind";
import { uniqueName } from "./kind";

/** Closure: a relationship pulls both ends, induced relationships come along. */
function slice(ir: ErIR, ids: ReadonlySet<string>): ErIR | undefined {
  const nodes = new Set<string>(ir.entities.filter((e) => ids.has(e.id)).map((e) => e.id));
  for (const r of ir.relationships) {
    if (!ids.has(r.id)) continue;
    nodes.add(r.from);
    nodes.add(r.to);
  }
  if (nodes.size === 0) return undefined;

  return omitUndefined({
    kind: "er" as const,
    direction: ir.direction,
    entities: ir.entities.filter((e) => nodes.has(e.id)),
    relationships: ir.relationships.filter((r) => nodes.has(r.from) && nodes.has(r.to)),
  });
}

function merge(ir: ErIR, inc: ErIR): MergeResult<ErIR> {
  if (inc.entities.length === 0) return { reason: "the clipboard holds an empty ER diagram" };

  const names = new Set(ir.entities.map((e) => e.name));
  const map = new Map<string, EntityId>();

  const entities: ErEntity[] = inc.entities.flatMap((e) => {
    if (!ER_NAME_RE.test(e.name)) return [];
    const id = newId("entity");
    map.set(e.id, id);
    return [{ ...e, id, name: uniqueName(e.name, names), attributes: e.attributes.map((a) => ({ ...a, id: newId("attribute") })) }];
  });

  const relationships: ErRelationship[] = inc.relationships.flatMap((r) => {
    const from = map.get(r.from);
    const to = map.get(r.to);
    if (from === undefined || to === undefined) return [];
    return [{ ...r, id: newId("relation"), from, to }];
  });

  if (entities.length === 0) return { reason: "nothing in the clipboard could be pasted here" };

  return {
    // `direction` is the target's: a paste must not re-orient the diagram
    ir: { ...ir, entities: [...ir.entities, ...entities], relationships: [...ir.relationships, ...relationships] },
    added: [...entities.map((e) => e.id as string), ...relationships.map((r) => r.id as string)],
  };
}

export const erClipboard: KindClipboard<ErIR> = { slice, merge };
