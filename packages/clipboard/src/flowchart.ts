import type { FlowchartEndpoint, FlowchartIR, FlowchartNode, FlowchartSubgraph, NodeId, SubgraphId } from "@gmermaid/ir";
import { newId, normalizeFlowchartEdge, omitUndefined } from "@gmermaid/ir";
import type { KindClipboard, MergeResult } from "./kind";
import { saturate } from "./kind";

/** Closure: subgraphs pull their contents, edges pull their endpoints, a
 * parent left behind is dropped, and edges induced by the selection join it.
 * See the header comment in `clipboard.ts`. */
function slice(ir: FlowchartIR, ids: ReadonlySet<string>): FlowchartIR | undefined {
  const isSub = new Set<string>(ir.subgraphs.map((s) => s.id));
  const isNode = new Set<string>(ir.nodes.map((n) => n.id));

  const seedSubs: string[] = ir.subgraphs.filter((s) => ids.has(s.id)).map((s) => s.id);
  const seedNodes: string[] = ir.nodes.filter((n) => ids.has(n.id)).map((n) => n.id);

  // a selected edge declares the things it joins
  for (const e of ir.edges) {
    if (!ids.has(e.id)) continue;
    for (const end of [e.from, e.to] as readonly string[]) {
      if (isSub.has(end)) seedSubs.push(end);
      else if (isNode.has(end)) seedNodes.push(end);
    }
  }

  const subs = saturate(seedSubs, (have) =>
    ir.subgraphs.filter((s) => s.parent !== undefined && have.has(s.parent)).map((s) => s.id),
  );
  const nodes = new Set<string>(seedNodes);
  for (const n of ir.nodes) if (n.parent !== undefined && subs.has(n.parent)) nodes.add(n.id);

  if (subs.size === 0 && nodes.size === 0) return undefined;

  const inside = (id: string): boolean => nodes.has(id) || subs.has(id);
  const keptParent = (parent: SubgraphId | undefined) => (parent !== undefined && subs.has(parent) ? parent : undefined);

  return {
    kind: "flowchart",
    direction: ir.direction,
    nodes: ir.nodes.filter((n) => nodes.has(n.id)).map((n) => omitUndefined({ ...n, parent: keptParent(n.parent) })),
    subgraphs: ir.subgraphs.filter((s) => subs.has(s.id)).map((s) => omitUndefined({ ...s, parent: keptParent(s.parent) })),
    // both endpoints inside = the edge belongs to the region, selected or not
    edges: ir.edges.filter((e) => inside(e.from) && inside(e.to)),
  };
}

function merge(ir: FlowchartIR, inc: FlowchartIR): MergeResult<FlowchartIR> {
  if (inc.nodes.length === 0 && inc.subgraphs.length === 0) {
    return { reason: "the clipboard holds an empty flowchart" };
  }

  const map = new Map<string, string>();
  for (const s of inc.subgraphs) map.set(s.id, newId("subgraph"));
  for (const n of inc.nodes) map.set(n.id, newId("node"));
  const freshParent = (parent: SubgraphId | undefined) => (parent === undefined ? undefined : (map.get(parent) as SubgraphId | undefined));

  const subgraphs: FlowchartSubgraph[] = inc.subgraphs.map((s) =>
    omitUndefined({ ...s, id: map.get(s.id) as SubgraphId, parent: freshParent(s.parent) }),
  );
  const nodes: FlowchartNode[] = inc.nodes.map((n) => omitUndefined({ ...n, id: map.get(n.id) as NodeId, parent: freshParent(n.parent) }));

  const edges = inc.edges.flatMap((e) => {
    const from = map.get(e.from) as FlowchartEndpoint | undefined;
    const to = map.get(e.to) as FlowchartEndpoint | undefined;
    // a reference out of the pasted set is dropped; so is a self-loop, which
    // `addEdge` refuses too (there is no layout for one)
    if (from === undefined || to === undefined || (from as string) === (to as string)) return [];
    return [normalizeFlowchartEdge({ ...e, id: newId("edge"), from, to })];
  });

  return {
    // `direction` is the target's: a paste must not re-orient the diagram
    ir: { ...ir, nodes: [...ir.nodes, ...nodes], subgraphs: [...ir.subgraphs, ...subgraphs], edges: [...ir.edges, ...edges] },
    added: [...nodes.map((n) => n.id as string), ...subgraphs.map((s) => s.id as string), ...edges.map((e) => e.id as string)],
  };
}

export const flowchartClipboard: KindClipboard<FlowchartIR> = { slice, merge };
