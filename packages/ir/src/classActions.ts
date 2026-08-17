import type { ClassId, RelationId } from "./ids";
import type { ClassIR, ClassMember, ClassMethod, ClassNode, ClassRelation, RelationType } from "./classdiagram";

// Mermaid identifies classes by NAME, so names double as the exchange
// identity: they must be mermaid-safe and unique. Internal ClassId stays
// stable across renames; codegen maps id → name on export.
export const CLASS_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type ClassAction =
  | { type: "addClass"; node: ClassNode }
  | { type: "removeClass"; id: ClassId }
  | { type: "renameClass"; id: ClassId; name: string }
  | { type: "setStereotype"; id: ClassId; stereotype?: string }
  | { type: "setMembers"; id: ClassId; attributes: readonly ClassMember[]; methods: readonly ClassMethod[] }
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
      const n = action.node;
      const stereotype = norm(n.stereotype);
      return {
        ...ir,
        classes: [
          ...ir.classes,
          {
            id: n.id,
            name: n.name,
            attributes: n.attributes,
            methods: n.methods,
            ...(stereotype !== undefined ? { stereotype } : {}),
          },
        ],
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
      const stereotype = action.stereotype === "" ? undefined : action.stereotype;
      if (stereotype === c.stereotype) return ir;
      return {
        ...ir,
        classes: ir.classes.map((x) =>
          x.id === action.id
            ? { id: x.id, name: x.name, attributes: x.attributes, methods: x.methods, ...(stereotype !== undefined ? { stereotype } : {}) }
            : x,
        ),
      };
    }

    case "setMembers": {
      const c = ir.classes.find((x) => x.id === action.id);
      if (!c) return ir;
      return {
        ...ir,
        classes: ir.classes.map((x) =>
          x.id === action.id ? { ...x, attributes: action.attributes, methods: action.methods } : x,
        ),
      };
    }

    case "addRelation": {
      const r = action.relation;
      if (ir.relations.some((x) => x.id === r.id)) return ir;
      const known = (id: ClassId) => ir.classes.some((c) => c.id === id);
      if (!known(r.from) || !known(r.to)) return ir;
      if (r.from === r.to) return ir;
      const label = norm(r.label);
      const fromCardinality = norm(r.fromCardinality);
      const toCardinality = norm(r.toCardinality);
      return {
        ...ir,
        relations: [
          ...ir.relations,
          {
            id: r.id,
            from: r.from,
            to: r.to,
            type: r.type,
            ...(label !== undefined ? { label } : {}),
            ...(fromCardinality !== undefined ? { fromCardinality } : {}),
            ...(toCardinality !== undefined ? { toCardinality } : {}),
          },
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
          x.id === action.id
            ? {
                id: x.id,
                from: x.from,
                to: x.to,
                type,
                ...(label !== undefined ? { label } : {}),
                ...(fromCardinality !== undefined ? { fromCardinality } : {}),
                ...(toCardinality !== undefined ? { toCardinality } : {}),
              }
            : x,
        ),
      };
    }
  }
}

export function emptyClassMembers(): { attributes: ClassMember[]; methods: ClassMethod[] } {
  return { attributes: [], methods: [] };
}
