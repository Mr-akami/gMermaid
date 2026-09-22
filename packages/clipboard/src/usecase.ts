import type { BoundaryId, UseCase, UsecaseActor, UsecaseBoundary, UsecaseIR, UsecaseNodeId, UsecaseNote, UsecaseRelation } from "@gmermaid/ir";
import { newId, normalizeUsecaseRelation, omitUndefined, usecaseNameRejection } from "@gmermaid/ir";
import type { KindClipboard, MergeResult } from "./kind";
import { uniqueName } from "./kind";

/** Closure: a boundary pulls its members, a relation pulls both ends, a
 * boundary left behind is dropped, induced relations and attached notes come
 * along. See the header comment in `clipboard.ts`. */
function slice(ir: UsecaseIR, ids: ReadonlySet<string>): UsecaseIR | undefined {
  const boundaries = new Set<string>(ir.boundaries.filter((b) => ids.has(b.id)).map((b) => b.id));
  const inBoundary = (b: BoundaryId | undefined) => b !== undefined && boundaries.has(b);
  const nodes = new Set<string>([
    ...ir.actors.filter((a) => ids.has(a.id) || inBoundary(a.boundary)).map((a) => a.id),
    ...ir.usecases.filter((u) => ids.has(u.id) || inBoundary(u.boundary)).map((u) => u.id),
  ]);
  for (const r of ir.relations) {
    if (!ids.has(r.id)) continue;
    nodes.add(r.from);
    nodes.add(r.to);
  }
  for (const n of ir.notes) if (ids.has(n.id)) nodes.add(n.target);

  if (nodes.size === 0 && boundaries.size === 0) return undefined;

  const kept = (b: BoundaryId | undefined) => (inBoundary(b) ? b : undefined);

  return omitUndefined({
    kind: "usecase" as const,
    direction: ir.direction,
    actors: ir.actors.filter((a) => nodes.has(a.id)).map((a) => omitUndefined({ ...a, boundary: kept(a.boundary) })),
    usecases: ir.usecases.filter((u) => nodes.has(u.id)).map((u) => omitUndefined({ ...u, boundary: kept(u.boundary) })),
    boundaries: ir.boundaries.filter((b) => boundaries.has(b.id)),
    relations: ir.relations.filter((r) => nodes.has(r.from) && nodes.has(r.to)),
    notes: ir.notes.filter((n) => nodes.has(n.target)),
  });
}

function merge(ir: UsecaseIR, inc: UsecaseIR): MergeResult<UsecaseIR> {
  if (inc.actors.length === 0 && inc.usecases.length === 0) {
    return { reason: "the clipboard holds an empty use case diagram" };
  }

  // actors, use cases and boundaries share ONE name space in mermaid
  const names = new Set([
    ...ir.actors.map((a) => a.name),
    ...ir.usecases.map((u) => u.name),
    ...ir.boundaries.map((b) => b.name),
  ]);

  const boundaryMap = new Map<string, BoundaryId>();
  const boundaries: UsecaseBoundary[] = inc.boundaries.flatMap((b) => {
    const name = uniqueName(b.name, names);
    if (usecaseNameRejection(name) !== undefined) return [];
    const id = newId("boundary");
    boundaryMap.set(b.id, id);
    return [{ ...b, id, name }];
  });

  const map = new Map<string, UsecaseNodeId>();
  const rename = <T extends { name: string; boundary?: BoundaryId }>(x: T) => {
    const name = uniqueName(x.name, names);
    if (usecaseNameRejection(name) !== undefined) return undefined;
    return omitUndefined({ ...x, name, boundary: x.boundary === undefined ? undefined : boundaryMap.get(x.boundary) });
  };

  const actors: UsecaseActor[] = inc.actors.flatMap((a) => {
    const next = rename(a);
    if (next === undefined) return [];
    const id = newId("actor");
    map.set(a.id, id);
    return [{ ...next, id }];
  });
  const usecases: UseCase[] = inc.usecases.flatMap((u) => {
    const next = rename(u);
    if (next === undefined) return [];
    const id = newId("usecase");
    map.set(u.id, id);
    return [{ ...next, id }];
  });

  const relations: UsecaseRelation[] = inc.relations.flatMap((r) => {
    const from = map.get(r.from);
    const to = map.get(r.to);
    if (from === undefined || to === undefined) return [];
    return [normalizeUsecaseRelation({ ...r, id: newId("usecaseRelation"), from, to })];
  });

  const notes: UsecaseNote[] = inc.notes.flatMap((n) => {
    const target = map.get(n.target);
    return target === undefined ? [] : [{ ...n, id: newId("note"), target }];
  });

  if (actors.length === 0 && usecases.length === 0) return { reason: "nothing in the clipboard could be pasted here" };

  // mermaid has no "belongs to" statement: an empty boundary is a box with
  // nothing in it, and codegen would emit `systemBoundary X end`
  const members = [...actors, ...usecases];
  const kept = boundaries.filter((b) => members.some((x) => x.boundary === b.id));

  return {
    // `direction` is the target's: a paste must not re-orient the diagram
    ir: {
      ...ir,
      actors: [...ir.actors, ...actors],
      usecases: [...ir.usecases, ...usecases],
      boundaries: [...ir.boundaries, ...kept],
      relations: [...ir.relations, ...relations],
      notes: [...ir.notes, ...notes],
    },
    added: [
      ...actors.map((a) => a.id as string),
      ...usecases.map((u) => u.id as string),
      ...kept.map((b) => b.id as string),
      ...relations.map((r) => r.id as string),
      ...notes.map((n) => n.id as string),
    ],
  };
}

export const usecaseClipboard: KindClipboard<UsecaseIR> = { slice, merge };
