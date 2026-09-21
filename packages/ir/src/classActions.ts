import type { ClassId, NamespaceId, NoteId, RelationId } from "./ids";
import type {
  ClassDirection,
  ClassIR,
  ClassMember,
  ClassMethod,
  ClassNamespace,
  ClassNode,
  ClassNote,
  ClassRelation,
  RelationHead,
  RelationLine,
} from "./classdiagram";
import { omitUndefined } from "./omitUndefined";

// Mermaid identifies classes by NAME, so names double as the exchange
// identity: they must be unique and expressible in mermaid. Anything but a
// backtick / `~` (the generic delimiter) / newline is allowed — codegen
// wraps non-identifier names in backticks. Internal ClassId stays stable
// across renames; codegen maps id → name on export.
export const CLASS_NAME_RE = /^(?=\S)[^`~\r\n]*\S$/;

// Member names share the identifier grammar: colons, whitespace, brackets
// or newlines would be re-tokenized as type/params on the next
// codegen → parse round trip (attributes silently becoming methods etc.).
export const MEMBER_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// a type ending in `$`/`*` would read back as a classifier
const validType = (t: string | undefined): boolean => t === undefined || (!/[\r\n]/.test(t) && !/[$*]$/.test(t) && t.trim() === t && t !== "");
const validAttribute = (m: ClassMember): boolean => MEMBER_NAME_RE.test(m.name) && validType(m.type);
// mermaid takes ONE classifier per member
const validMethod = (m: ClassMethod): boolean => validAttribute(m) && !/[)\r\n]/.test(m.params) && !(m.abstract && m.static);

const sameAttribute = (a: ClassMember, b: ClassMember): boolean =>
  a.name === b.name && a.type === b.type && a.visibility === b.visibility && (a.static ?? false) === (b.static ?? false);
const sameMethod = (a: ClassMethod, b: ClassMethod): boolean =>
  sameAttribute(a, b) && a.params === b.params && (a.abstract ?? false) === (b.abstract ?? false);
const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

export type ClassAction =
  | { type: "addClass"; node: ClassNode }
  | { type: "removeClass"; id: ClassId }
  | { type: "renameClass"; id: ClassId; name: string }
  | { type: "setClassLabel"; id: ClassId; label?: string }
  | { type: "setClassGeneric"; id: ClassId; generic?: string }
  | { type: "setStereotypes"; id: ClassId; stereotypes: readonly string[] }
  | { type: "setMembers"; id: ClassId; attributes: readonly ClassMember[]; methods: readonly ClassMethod[] }
  /** namespace absent = move to top level */
  | { type: "setClassNamespace"; id: ClassId; namespace?: NamespaceId }
  | { type: "setDirection"; direction: ClassDirection }
  | { type: "addRelation"; relation: ClassRelation }
  | { type: "removeRelation"; id: RelationId }
  | {
      type: "updateRelation";
      id: RelationId;
      line?: RelationLine;
      headFrom?: RelationHead;
      headTo?: RelationHead;
      label?: string;
      fromCardinality?: string;
      toCardinality?: string;
    }
  | { type: "addNote"; note: ClassNote }
  /** target null = detach into a free-floating note */
  | { type: "updateNote"; id: NoteId; text?: string; target?: ClassId | null }
  | { type: "removeNote"; id: NoteId }
  /** mermaid rejects an empty namespace, so one is born with its first members */
  | { type: "addNamespace"; namespace: ClassNamespace; classes: readonly ClassId[] }
  | { type: "renameNamespace"; id: NamespaceId; name: string }
  | { type: "removeNamespace"; id: NamespaceId };

const norm = (v: string | undefined) => (v === "" ? undefined : v);
const cleanStereotypes = (list: readonly string[]): string[] => list.map((s) => s.trim()).filter((s) => s !== "" && !/[<>\r\n]/.test(s));

/** Drop namespaces no class belongs to — mermaid cannot express them. */
function pruneNamespaces(ir: ClassIR): ClassIR {
  const used = new Set(ir.classes.map((c) => c.namespace));
  const kept = ir.namespaces.filter((n) => used.has(n.id));
  return kept.length === ir.namespaces.length ? ir : { ...ir, namespaces: kept };
}

export function applyClassAction(ir: ClassIR, action: ClassAction): ClassIR {
  switch (action.type) {
    case "addClass": {
      const n = action.node;
      if (ir.classes.some((c) => c.id === n.id || c.name === n.name)) return ir;
      if (!CLASS_NAME_RE.test(n.name)) return ir;
      if (!n.attributes.every(validAttribute) || !n.methods.every(validMethod)) return ir;
      if (n.namespace !== undefined && !ir.namespaces.some((x) => x.id === n.namespace)) return ir;
      return {
        ...ir,
        classes: [
          ...ir.classes,
          omitUndefined({ ...n, label: norm(n.label), generic: norm(n.generic), stereotypes: cleanStereotypes(n.stereotypes) }),
        ],
      };
    }

    case "removeClass": {
      if (!ir.classes.some((c) => c.id === action.id)) return ir;
      return pruneNamespaces({
        ...ir,
        classes: ir.classes.filter((c) => c.id !== action.id),
        relations: ir.relations.filter((r) => r.from !== action.id && r.to !== action.id),
        notes: ir.notes.filter((n) => n.target !== action.id),
      });
    }

    case "renameClass": {
      const c = ir.classes.find((x) => x.id === action.id);
      if (!c || c.name === action.name) return ir;
      if (!CLASS_NAME_RE.test(action.name)) return ir;
      if (ir.classes.some((x) => x.name === action.name)) return ir; // names are the exchange identity
      return { ...ir, classes: ir.classes.map((x) => (x.id === action.id ? { ...x, name: action.name } : x)) };
    }

    case "setClassLabel": {
      const c = ir.classes.find((x) => x.id === action.id);
      if (!c) return ir;
      const label = norm(action.label);
      if (label === c.label) return ir;
      return { ...ir, classes: ir.classes.map((x) => (x.id === action.id ? omitUndefined({ ...x, label }) : x)) };
    }

    case "setClassGeneric": {
      const c = ir.classes.find((x) => x.id === action.id);
      if (!c) return ir;
      const generic = norm(action.generic);
      if (generic === c.generic) return ir;
      if (generic !== undefined && /[~\r\n]/.test(generic)) return ir;
      return { ...ir, classes: ir.classes.map((x) => (x.id === action.id ? omitUndefined({ ...x, generic }) : x)) };
    }

    case "setStereotypes": {
      const c = ir.classes.find((x) => x.id === action.id);
      if (!c) return ir;
      const stereotypes = cleanStereotypes(action.stereotypes);
      if (sameList(stereotypes, c.stereotypes)) return ir;
      return { ...ir, classes: ir.classes.map((x) => (x.id === action.id ? { ...x, stereotypes } : x)) };
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

    case "setClassNamespace": {
      const c = ir.classes.find((x) => x.id === action.id);
      if (!c || c.namespace === action.namespace) return ir;
      if (action.namespace !== undefined && !ir.namespaces.some((n) => n.id === action.namespace)) return ir;
      return pruneNamespaces({
        ...ir,
        classes: ir.classes.map((x) => (x.id === action.id ? omitUndefined({ ...x, namespace: action.namespace }) : x)),
      });
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
      const next = omitUndefined({
        ...r,
        line: action.line ?? r.line,
        headFrom: action.headFrom ?? r.headFrom,
        headTo: action.headTo ?? r.headTo,
        label: action.label !== undefined ? norm(action.label) : r.label,
        fromCardinality: action.fromCardinality !== undefined ? norm(action.fromCardinality) : r.fromCardinality,
        toCardinality: action.toCardinality !== undefined ? norm(action.toCardinality) : r.toCardinality,
      });
      if (
        next.line === r.line &&
        next.headFrom === r.headFrom &&
        next.headTo === r.headTo &&
        next.label === r.label &&
        next.fromCardinality === r.fromCardinality &&
        next.toCardinality === r.toCardinality
      ) {
        return ir;
      }
      return { ...ir, relations: ir.relations.map((x) => (x.id === action.id ? next : x)) };
    }

    case "addNote": {
      const n = action.note;
      if (ir.notes.some((x) => x.id === n.id)) return ir;
      if (n.target !== undefined && !ir.classes.some((c) => c.id === n.target)) return ir;
      return { ...ir, notes: [...ir.notes, omitUndefined({ ...n })] };
    }

    case "updateNote": {
      const n = ir.notes.find((x) => x.id === action.id);
      if (!n) return ir;
      const text = action.text ?? n.text;
      const target = action.target === null ? undefined : action.target ?? n.target;
      if (target !== undefined && !ir.classes.some((c) => c.id === target)) return ir;
      if (text === n.text && target === n.target) return ir;
      return { ...ir, notes: ir.notes.map((x) => (x.id === action.id ? omitUndefined({ ...x, text, target }) : x)) };
    }

    case "removeNote": {
      if (!ir.notes.some((n) => n.id === action.id)) return ir;
      return { ...ir, notes: ir.notes.filter((n) => n.id !== action.id) };
    }

    case "addNamespace": {
      const ns = action.namespace;
      if (ir.namespaces.some((x) => x.id === ns.id || x.name === ns.name)) return ir;
      if (!CLASS_NAME_RE.test(ns.name)) return ir;
      const members = action.classes.filter((id) => ir.classes.some((c) => c.id === id));
      if (members.length === 0) return ir;
      return pruneNamespaces({
        ...ir,
        namespaces: [...ir.namespaces, ns],
        classes: ir.classes.map((c) => (members.includes(c.id) ? { ...c, namespace: ns.id } : c)),
      });
    }

    case "renameNamespace": {
      const ns = ir.namespaces.find((x) => x.id === action.id);
      if (!ns || ns.name === action.name) return ir;
      if (!CLASS_NAME_RE.test(action.name)) return ir;
      if (ir.namespaces.some((x) => x.name === action.name)) return ir;
      return { ...ir, namespaces: ir.namespaces.map((x) => (x.id === action.id ? { ...x, name: action.name } : x)) };
    }

    case "removeNamespace": {
      if (!ir.namespaces.some((x) => x.id === action.id)) return ir;
      return {
        ...ir,
        namespaces: ir.namespaces.filter((x) => x.id !== action.id),
        classes: ir.classes.map((c) => (c.namespace === action.id ? omitUndefined({ ...c, namespace: undefined }) : c)),
      };
    }
  }
}

export function emptyClassMembers(): { attributes: ClassMember[]; methods: ClassMethod[] } {
  return { attributes: [], methods: [] };
}
