import type { ArchEdge, ArchGroup, ArchGroupId, ArchJunction, ArchNodeId, ArchService, ArchitectureIR } from "@gmermaid/ir";
import { archNameRejection, newId, omitUndefined, settleArchitecture } from "@gmermaid/ir";
import type { KindClipboard, MergeResult } from "./kind";
import { saturate, uniqueName } from "./kind";

/** Closure: a group pulls its sub-groups and members, an edge pulls both
 * ends, a group left behind is dropped (its members go to the top level),
 * induced edges come along. See the header comment in `clipboard.ts`. */
function slice(ir: ArchitectureIR, ids: ReadonlySet<string>): ArchitectureIR | undefined {
  const groups = saturate<string>(
    ir.groups.filter((g) => ids.has(g.id)).map((g) => g.id),
    (have) => ir.groups.filter((g) => g.parent !== undefined && have.has(g.parent)).map((g) => g.id),
  );
  const inGroups = (g: ArchGroupId | undefined) => g !== undefined && groups.has(g);
  const nodes = new Set<string>([
    ...ir.services.filter((s) => ids.has(s.id) || inGroups(s.group)).map((s) => s.id),
    ...ir.junctions.filter((j) => ids.has(j.id) || inGroups(j.group)).map((j) => j.id),
  ]);
  for (const e of ir.edges) {
    if (!ids.has(e.id)) continue;
    nodes.add(e.from);
    nodes.add(e.to);
  }
  if (nodes.size === 0 && groups.size === 0) return undefined;

  const kept = (g: ArchGroupId | undefined) => (inGroups(g) ? g : undefined);
  return settleArchitecture(
    omitUndefined({
      kind: "architecture" as const,
      groups: ir.groups.filter((g) => groups.has(g.id)).map((g) => omitUndefined({ ...g, parent: kept(g.parent) })),
      services: ir.services.filter((s) => nodes.has(s.id)).map((s) => omitUndefined({ ...s, group: kept(s.group) })),
      junctions: ir.junctions.filter((j) => nodes.has(j.id)).map((j) => omitUndefined({ ...j, group: kept(j.group) })),
      edges: ir.edges.filter((e) => nodes.has(e.from) && nodes.has(e.to)),
    }),
  );
}

function merge(ir: ArchitectureIR, inc: ArchitectureIR): MergeResult<ArchitectureIR> {
  if (inc.services.length === 0 && inc.junctions.length === 0) {
    return { reason: "the clipboard holds an empty architecture diagram" };
  }

  // groups, services and junctions share ONE name space in mermaid
  const names = new Set([...ir.groups.map((g) => g.name), ...ir.services.map((s) => s.name), ...ir.junctions.map((j) => j.name)]);

  const groupMap = new Map<string, ArchGroupId>();
  const groupNames = new Map<string, string>();
  for (const g of inc.groups) {
    const name = uniqueName(g.name, names);
    if (archNameRejection(name) !== undefined) continue;
    groupMap.set(g.id, newId("archGroup"));
    groupNames.set(g.id, name);
  }
  const groups: ArchGroup[] = inc.groups.flatMap((g) => {
    const id = groupMap.get(g.id);
    if (id === undefined) return [];
    const parent = g.parent === undefined ? undefined : groupMap.get(g.parent);
    return [omitUndefined({ ...g, id, name: groupNames.get(g.id)!, parent })];
  });

  const map = new Map<string, ArchNodeId>();
  const services: ArchService[] = inc.services.flatMap((s) => {
    const name = uniqueName(s.name, names);
    if (archNameRejection(name) !== undefined) return [];
    const id = newId("archService");
    map.set(s.id, id);
    return [omitUndefined({ ...s, id, name, group: s.group === undefined ? undefined : groupMap.get(s.group) })];
  });
  const junctions: ArchJunction[] = inc.junctions.flatMap((j) => {
    const name = uniqueName(j.name, names);
    if (archNameRejection(name) !== undefined) return [];
    const id = newId("archJunction");
    map.set(j.id, id);
    return [omitUndefined({ ...j, id, name, group: j.group === undefined ? undefined : groupMap.get(j.group) })];
  });

  if (services.length === 0 && junctions.length === 0) return { reason: "nothing in the clipboard could be pasted here" };

  const edges: ArchEdge[] = inc.edges.flatMap((e) => {
    const from = map.get(e.from);
    const to = map.get(e.to);
    return from === undefined || to === undefined ? [] : [{ ...e, id: newId("archEdge"), from, to }];
  });

  const merged = settleArchitecture({
    // a paste has no anchor, and the target's grid is the layout's business
    ...ir,
    groups: [...ir.groups, ...groups],
    services: [...ir.services, ...services],
    junctions: [...ir.junctions, ...junctions],
    edges: [...ir.edges, ...edges],
  });

  return {
    ir: merged,
    added: [
      ...groups.map((g) => g.id as string),
      ...services.map((s) => s.id as string),
      ...junctions.map((j) => j.id as string),
      ...edges.map((e) => e.id as string),
    ],
  };
}

export const architectureClipboard: KindClipboard<ArchitectureIR> = { slice, merge };
