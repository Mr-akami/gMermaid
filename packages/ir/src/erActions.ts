import type { AttributeId, EntityId, RelationId } from "./ids";
import type { ErAttribute, ErCardinality, ErDirection, ErEntity, ErIR, ErKey, ErRelationship } from "./er";
import { omitUndefined } from "./omitUndefined";

// Entities are identified in mermaid text by NAME. Codegen quotes any name
// that is not a plain identifier, so only what a quoted name cannot carry is
// forbidden.
export const ER_NAME_RE = /^[^"\r\n]+$/;
/** mermaid's attribute grammar: type may carry `(…)` and `[]`, name may not. */
export const ER_ATTR_TYPE_RE = /^[A-Za-z_][A-Za-z0-9_\-[\]()]*$/;
export const ER_ATTR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export type ErAction =
  | { type: "addEntity"; entity: ErEntity }
  | { type: "removeEntity"; id: EntityId }
  | { type: "renameEntity"; id: EntityId; name: string }
  | { type: "setAlias"; id: EntityId; alias: string }
  | { type: "addAttribute"; entityId: EntityId; attribute: ErAttribute }
  | { type: "removeAttribute"; entityId: EntityId; id: AttributeId }
  | {
      type: "updateAttribute";
      entityId: EntityId;
      id: AttributeId;
      attrType?: string;
      name?: string;
      keys?: readonly ErKey[];
      comment?: string;
    }
  // `to` is the index the attribute ends up at
  | { type: "moveAttribute"; entityId: EntityId; id: AttributeId; to: number }
  | { type: "setDirection"; direction: ErDirection }
  | { type: "addRelationship"; relationship: ErRelationship }
  | { type: "removeRelationship"; id: RelationId }
  | {
      type: "updateRelationship";
      id: RelationId;
      fromCard?: ErCardinality;
      toCard?: ErCardinality;
      identifying?: boolean;
      label?: string;
    }
  | { type: "retargetRelationship"; id: RelationId; from?: EntityId; to?: EntityId };

const norm = (v: string | undefined): string | undefined => (v === undefined || v === "" ? undefined : v);

const entityNameTaken = (ir: ErIR, name: string): boolean => ir.entities.some((e) => e.name === name);

/** Why relationship `id` cannot be re-pointed at `ends`, or undefined. The
 * reducer rejects with it and the property window shows it. */
export function erRetargetRejection(
  ir: ErIR,
  id: RelationId,
  ends: { readonly from?: EntityId; readonly to?: EntityId },
): string | undefined {
  const r = ir.relationships.find((x) => x.id === id);
  if (r === undefined) return "unknown relationship";
  const from = ends.from ?? r.from;
  const to = ends.to ?? r.to;
  if (!ir.entities.some((e) => e.id === from)) return "unknown source";
  if (!ir.entities.some((e) => e.id === to)) return "unknown target";
  return undefined;
}

/** Why `attribute` cannot be stored, or undefined. Shared with the editor so
 * the property window can say what the reducer would silently refuse. */
export function erAttributeRejection(type: string, name: string): string | undefined {
  if (!ER_ATTR_TYPE_RE.test(type)) return "type must be one word (letters, digits, _ - [] ())";
  if (!ER_ATTR_NAME_RE.test(name)) return "name must be one word (letters, digits, _ -)";
  return undefined;
}

function mapEntity(ir: ErIR, id: EntityId, f: (e: ErEntity) => ErEntity): ErIR {
  return { ...ir, entities: ir.entities.map((e) => (e.id === id ? f(e) : e)) };
}

const dedupeKeys = (keys: readonly ErKey[]): readonly ErKey[] => keys.filter((k, i) => keys.indexOf(k) === i);

export function applyErAction(ir: ErIR, action: ErAction): ErIR {
  switch (action.type) {
    case "addEntity": {
      const e = action.entity;
      if (ir.entities.some((x) => x.id === e.id) || entityNameTaken(ir, e.name) || !ER_NAME_RE.test(e.name)) return ir;
      if (e.attributes.some((a) => erAttributeRejection(a.type, a.name) !== undefined)) return ir;
      return { ...ir, entities: [...ir.entities, omitUndefined({ ...e, alias: norm(e.alias) })] };
    }

    case "removeEntity": {
      if (!ir.entities.some((e) => e.id === action.id)) return ir;
      return {
        ...ir,
        entities: ir.entities.filter((e) => e.id !== action.id),
        relationships: ir.relationships.filter((r) => r.from !== action.id && r.to !== action.id),
      };
    }

    case "renameEntity": {
      const e = ir.entities.find((x) => x.id === action.id);
      if (!e || e.name === action.name) return ir;
      if (!ER_NAME_RE.test(action.name) || entityNameTaken(ir, action.name)) return ir;
      return mapEntity(ir, action.id, (x) => ({ ...x, name: action.name }));
    }

    case "setAlias": {
      const e = ir.entities.find((x) => x.id === action.id);
      if (!e || e.alias === norm(action.alias)) return ir;
      const alias = norm(action.alias);
      return mapEntity(ir, action.id, (x) => omitUndefined({ ...x, alias }));
    }

    case "addAttribute": {
      const a = action.attribute;
      const e = ir.entities.find((x) => x.id === action.entityId);
      if (!e || e.attributes.some((x) => x.id === a.id) || erAttributeRejection(a.type, a.name) !== undefined) return ir;
      const next = omitUndefined({ ...a, keys: dedupeKeys(a.keys), comment: norm(a.comment) });
      return mapEntity(ir, e.id, (x) => ({ ...x, attributes: [...x.attributes, next] }));
    }

    case "removeAttribute": {
      const e = ir.entities.find((x) => x.id === action.entityId);
      if (!e || !e.attributes.some((a) => a.id === action.id)) return ir;
      return mapEntity(ir, e.id, (x) => ({ ...x, attributes: x.attributes.filter((a) => a.id !== action.id) }));
    }

    case "updateAttribute": {
      const e = ir.entities.find((x) => x.id === action.entityId);
      const a = e?.attributes.find((x) => x.id === action.id);
      if (!e || !a) return ir;
      const type = action.attrType ?? a.type;
      const name = action.name ?? a.name;
      if (erAttributeRejection(type, name) !== undefined) return ir;
      const keys = action.keys !== undefined ? dedupeKeys(action.keys) : a.keys;
      const comment = action.comment !== undefined ? norm(action.comment) : a.comment;
      if (type === a.type && name === a.name && comment === a.comment && keys.join() === a.keys.join()) return ir;
      const next = omitUndefined({ ...a, type, name, keys, comment });
      return mapEntity(ir, e.id, (x) => ({ ...x, attributes: x.attributes.map((y) => (y.id === a.id ? next : y)) }));
    }

    case "moveAttribute": {
      const e = ir.entities.find((x) => x.id === action.entityId);
      const from = e?.attributes.findIndex((a) => a.id === action.id) ?? -1;
      if (!e || from < 0) return ir;
      const to = Math.max(0, Math.min(e.attributes.length - 1, action.to));
      if (to === from) return ir;
      const rest = e.attributes.filter((a) => a.id !== action.id);
      rest.splice(to, 0, e.attributes[from]!);
      return mapEntity(ir, e.id, (x) => ({ ...x, attributes: rest }));
    }

    case "setDirection":
      return ir.direction === action.direction ? ir : { ...ir, direction: action.direction };

    case "addRelationship": {
      const r = action.relationship;
      if (ir.relationships.some((x) => x.id === r.id)) return ir;
      // self-relationships are legal (recursive entities)
      if (!ir.entities.some((e) => e.id === r.from) || !ir.entities.some((e) => e.id === r.to)) return ir;
      return { ...ir, relationships: [...ir.relationships, omitUndefined({ ...r, label: norm(r.label) })] };
    }

    case "removeRelationship": {
      if (!ir.relationships.some((r) => r.id === action.id)) return ir;
      return { ...ir, relationships: ir.relationships.filter((r) => r.id !== action.id) };
    }

    case "updateRelationship": {
      const r = ir.relationships.find((x) => x.id === action.id);
      if (!r) return ir;
      const next = omitUndefined({
        ...r,
        fromCard: action.fromCard ?? r.fromCard,
        toCard: action.toCard ?? r.toCard,
        identifying: action.identifying ?? r.identifying,
        label: action.label !== undefined ? norm(action.label) : r.label,
      });
      if (
        next.fromCard === r.fromCard &&
        next.toCard === r.toCard &&
        next.identifying === r.identifying &&
        next.label === r.label
      ) {
        return ir;
      }
      return { ...ir, relationships: ir.relationships.map((x) => (x.id === r.id ? next : x)) };
    }

    case "retargetRelationship": {
      const r = ir.relationships.find((x) => x.id === action.id);
      if (r === undefined || erRetargetRejection(ir, action.id, action) !== undefined) return ir;
      const from = action.from ?? r.from;
      const to = action.to ?? r.to;
      if (from === r.from && to === r.to) return ir;
      return { ...ir, relationships: ir.relationships.map((x) => (x.id === r.id ? { ...x, from, to } : x)) };
    }
  }
}
