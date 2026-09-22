import type { ClassId, ClassIR, ClassNamespace, ClassNode, ClassNote, ClassRelation, NamespaceId } from "@gmermaid/ir";
import { CLASS_NAME_RE, MEMBER_NAME_RE, newId, omitUndefined } from "@gmermaid/ir";
import type { KindClipboard, MergeResult } from "./kind";
import { uniqueName } from "./kind";

/** Closure: a namespace pulls its classes, a relation pulls both ends, a
 * namespace left behind is dropped, induced relations and attached notes
 * come along. See the header comment in `clipboard.ts`. */
function slice(ir: ClassIR, ids: ReadonlySet<string>): ClassIR | undefined {
  const namespaces = new Set<string>(ir.namespaces.filter((n) => ids.has(n.id)).map((n) => n.id));
  const classes = new Set<string>(
    ir.classes.filter((c) => ids.has(c.id) || (c.namespace !== undefined && namespaces.has(c.namespace))).map((c) => c.id),
  );
  for (const r of ir.relations) {
    if (!ids.has(r.id)) continue;
    classes.add(r.from);
    classes.add(r.to);
  }
  // a selected note declares the class it is attached to
  for (const n of ir.notes) if (ids.has(n.id) && n.target !== undefined) classes.add(n.target);

  // a free-floating `note "…"` is a whole class diagram on its own
  const floating = ir.notes.some((n) => n.target === undefined && ids.has(n.id));
  if (classes.size === 0 && namespaces.size === 0 && !floating) return undefined;

  const keptNamespace = (ns: NamespaceId | undefined) => (ns !== undefined && namespaces.has(ns) ? ns : undefined);

  return omitUndefined({
    kind: "class" as const,
    direction: ir.direction,
    classes: ir.classes.filter((c) => classes.has(c.id)).map((c) => omitUndefined({ ...c, namespace: keptNamespace(c.namespace) })),
    relations: ir.relations.filter((r) => classes.has(r.from) && classes.has(r.to)),
    // a note travels with its target; a free-floating one only when selected
    notes: ir.notes.filter((n) => (n.target === undefined ? ids.has(n.id) : classes.has(n.target))),
    namespaces: ir.namespaces.filter((n) => namespaces.has(n.id)),
  });
}

function merge(ir: ClassIR, inc: ClassIR): MergeResult<ClassIR> {
  if (inc.classes.length === 0 && inc.notes.length === 0) return { reason: "the clipboard holds an empty class diagram" };

  // mermaid addresses classes and namespaces by name, so both namespaces are
  // kept collision-free with the one `_2`, `_3`, … rule
  const classNames = new Set(ir.classes.map((c) => c.name));
  const namespaceNames = new Set(ir.namespaces.map((n) => n.name));

  const nsMap = new Map<string, NamespaceId>();
  const namespaces: ClassNamespace[] = inc.namespaces.map((n) => {
    const id = newId("namespace");
    nsMap.set(n.id, id);
    return { id, name: uniqueName(n.name, namespaceNames) };
  });

  const classMap = new Map<string, ClassId>();
  const classes: ClassNode[] = [];
  for (const c of inc.classes) {
    if (!CLASS_NAME_RE.test(c.name)) continue; // the reducer would refuse it too
    const id = newId("class");
    classMap.set(c.id, id);
    classes.push(
      omitUndefined({
        ...c,
        id,
        name: uniqueName(c.name, classNames),
        attributes: c.attributes.filter((m) => MEMBER_NAME_RE.test(m.name)),
        methods: c.methods.filter((m) => MEMBER_NAME_RE.test(m.name)),
        namespace: c.namespace === undefined ? undefined : nsMap.get(c.namespace),
      }),
    );
  }

  const relations: ClassRelation[] = inc.relations.flatMap((r) => {
    const from = classMap.get(r.from);
    const to = classMap.get(r.to);
    if (from === undefined || to === undefined) return [];
    return [{ ...r, id: newId("relation"), from, to }];
  });

  const notes: ClassNote[] = inc.notes.flatMap((n) => {
    if (n.target === undefined) return [{ ...n, id: newId("note") }];
    const target = classMap.get(n.target);
    return target === undefined ? [] : [{ ...n, id: newId("note"), target }];
  });

  if (classes.length === 0 && notes.length === 0) return { reason: "nothing in the clipboard could be pasted here" };

  // mermaid cannot reopen a namespace, so an empty one is just a stray block
  const kept = namespaces.filter((n) => classes.some((c) => c.namespace === n.id));

  return {
    // `direction` is the target's: a paste must not re-orient the diagram
    ir: {
      ...ir,
      classes: [...ir.classes, ...classes],
      relations: [...ir.relations, ...relations],
      notes: [...ir.notes, ...notes],
      namespaces: [...ir.namespaces, ...kept],
    },
    added: [
      ...classes.map((c) => c.id as string),
      ...kept.map((n) => n.id as string),
      ...relations.map((r) => r.id as string),
      ...notes.map((n) => n.id as string),
    ],
  };
}

export const classClipboard: KindClipboard<ClassIR> = { slice, merge };
