import type { ClassId, RelationId } from "./ids";
import type { ClassDirection, ClassIR, ClassMember, ClassMethod, ClassNode, ClassRelation, RelationType } from "./classdiagram";
import { omitUndefined } from "./omitUndefined";

// Mermaid identifies classes by NAME, so names double as the exchange
// identity: they must be mermaid-safe and unique. Internal ClassId stays
// stable across renames; codegen maps id → name on export.
export const CLASS_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Member names share the identifier grammar: colons, whitespace, brackets
// or newlines would be re-tokenized as type/params on the next
// codegen → parse round trip (attributes silently becoming methods etc.).
export const MEMBER_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const validAttribute = (m: ClassMember): boolean =>
  MEMBER_NAME_RE.test(m.name) && (m.type === undefined || !/[\r\n]/.test(m.type));
const validMethod = (m: ClassMethod): boolean => validAttribute(m) && !/[)\r\n]/.test(m.params);

const sameAttribute = (a: ClassMember, b: ClassMember): boolean =>
  a.name === b.name && a.type === b.type && a.visibility === b.visibility;
const sameMethod = (a: ClassMethod, b: ClassMethod): boolean => sameAttribute(a, b) && a.params === b.params;

export type ClassAction =
  | { type: "addClass"; node: ClassNode }
  | { type: "removeClass"; id: ClassId }
  | { type: "renameClass"; id: ClassId; name: string }
  | { type: "setStereotype"; id: ClassId; stereotype?: string }
  | { type: "setMembers"; id: ClassId; attributes: readonly ClassMember[]; methods: readonly ClassMethod[] }
  | { type: "setDirection"; direction: ClassDirection }
  | { type: "addRelation"; relation: ClassRelation }
  | { type: "removeRelation"; id: RelationId }
  | {
      type: "updateRelation";
      id: RelationId;
      relationType?: RelationType;
      label?: string;
      fromCardinality?: string;
      toCardinality?: string;
    };

const norm = (v: string | undefined) => (v === "" ? undefined : v);

export function applyClassAction(ir: ClassIR, action: ClassAction): ClassIR {
  switch (action.type) {
    case "addClass": {
      if (ir.classes.some((c) => c.id === action.node.id || c.name === action.node.name)) return ir;
      if (!CLASS_NAME_RE.test(action.node.name)) return ir;
      if (!action.node.attributes.every(validAttribute) || !action.node.methods.every(validMethod)) return ir;
      return {
        ...ir,
        classes: [...ir.classes, omitUndefined({ ...action.node, stereotype: norm(action.node.stereotype) })],
      };
    }

    case "removeClass": {
      if (!ir.classes.some((c) => c.id === action.id)) return ir;
      return {
        ...ir,
        classes: ir.classes.filter((c) => c.id !== action.id),
        relations: ir.relations.filter((r) => r.from !== action.id && r.to !== action.id),
      };
    }

    case "renameClass": {
      const c = ir.classes.find((x) => x.id === action.id);
      if (!c || c.name === action.name) return ir;
      if (!CLASS_NAME_RE.test(action.name)) return ir;
      if (ir.classes.some((x) => x.name === action.name)) return ir; // names are the exchange identity
      return { ...ir, classes: ir.classes.map((x) => (x.id === action.id ? { ...x, name: action.name } : x)) };
    }

    case "setStereotype": {
      const c = ir.classes.find((x) => x.id === action.id);
      if (!c) return ir;
      const stereotype = norm(action.stereotype);
      if (stereotype === c.stereotype) return ir;
      return {
        ...ir,
        classes: ir.classes.map((x) => (x.id === action.id ? omitUndefined({ ...x, stereotype }) : x)),
      };
    }

    case "setMembers": {
      const c = ir.classes.find((x) => x.id === action.id);
      if (!c) return ir;
      if (!action.attributes.every(validAttribute) || !action.methods.every(validMethod)) return ir;
      if (
        c.attributes.length === action.attributes.length &&
        c.methods.length === action.methods.length &&
        c.attributes.every((a, i) => sameAttribute(a, action.attributes[i]!)) &&
        c.methods.every((m, i) => sameMethod(m, action.methods[i]!))
      ) {
        return ir;
      }
      return {
        ...ir,
        classes: ir.classes.map((x) =>
          x.id === action.id ? { ...x, attributes: action.attributes, methods: action.methods } : x,
        ),
      };
    }

    case "setDirection":
      return ir.direction === action.direction ? ir : { ...ir, direction: action.direction };

    case "addRelation": {
      const r = action.relation;
      if (ir.relations.some((x) => x.id === r.id)) return ir;
      const known = (id: ClassId) => ir.classes.some((c) => c.id === id);
      if (!known(r.from) || !known(r.to)) return ir;
      // self-relations (from === to) are allowed; layout draws them as a
      // rectangular detour on the node's right side
      return {
        ...ir,
        relations: [
          ...ir.relations,
          omitUndefined({
            ...r,
            label: norm(r.label),
            fromCardinality: norm(r.fromCardinality),
            toCardinality: norm(r.toCardinality),
          }),
        ],
      };
    }

    case "removeRelation": {
      if (!ir.relations.some((r) => r.id === action.id)) return ir;
      return { ...ir, relations: ir.relations.filter((r) => r.id !== action.id) };
    }

    case "updateRelation": {
      const r = ir.relations.find((x) => x.id === action.id);
      if (!r) return ir;
      const type = action.relationType ?? r.type;
      const label = action.label !== undefined ? norm(action.label) : r.label;
      const fromCardinality = action.fromCardinality !== undefined ? norm(action.fromCardinality) : r.fromCardinality;
      const toCardinality = action.toCardinality !== undefined ? norm(action.toCardinality) : r.toCardinality;
      if (type === r.type && label === r.label && fromCardinality === r.fromCardinality && toCardinality === r.toCardinality) {
        return ir;
      }
      return {
        ...ir,
        relations: ir.relations.map((x) =>
          x.id === action.id ? omitUndefined({ ...x, type, label, fromCardinality, toCardinality }) : x,
        ),
      };
    }
  }
}

export function emptyClassMembers(): { attributes: ClassMember[]; methods: ClassMethod[] } {
  return { attributes: [], methods: [] };
}
