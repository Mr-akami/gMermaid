import type { MindmapIR, MindmapNode, MindmapNodeId } from "@gmermaid/ir";
import { mindmapLabelRejection, mindmapRoot, newId, omitUndefined } from "@gmermaid/ir";
import type { KindClipboard, MergeResult } from "./kind";
import { saturate } from "./kind";

/**
 * Closure: a node pulls its whole subtree. A mindmap is a SINGLE rooted tree
 * — mermaid's outline syntax has no way to write two — so a selection that
 * closes to more than one top node cannot be expressed at all. That is the
 * one place this module answers `undefined` rather than inventing a root to
 * hang the pieces from.
 */
function slice(ir: MindmapIR, ids: ReadonlySet<string>): MindmapIR | undefined {
  const kept = saturate(
    ir.nodes.filter((n) => ids.has(n.id)).map((n) => n.id as string),
    (have) => ir.nodes.filter((n) => n.parent !== undefined && have.has(n.parent)).map((n) => n.id as string),
  );
  if (kept.size === 0) return undefined;

  const nodes = ir.nodes.filter((n) => kept.has(n.id));
  const tops = nodes.filter((n) => n.parent === undefined || !kept.has(n.parent));
  if (tops.length !== 1) return undefined;

  return { kind: "mindmap", nodes: nodes.map((n) => (n === tops[0] ? omitUndefined({ ...n, parent: undefined }) : n)) };
}

/**
 * The pasted tree hangs under the target's root — `pasteInto` takes no anchor
 * and a mindmap cannot hold two roots, so there is nowhere else for it to go.
 * Into an empty mindmap, the pasted root becomes the root.
 */
function merge(ir: MindmapIR, inc: MindmapIR): MergeResult<MindmapIR> {
  const incRoot = mindmapRoot(inc);
  if (incRoot === undefined) return { reason: "the clipboard holds an empty mindmap" };

  // a node the reducer would refuse takes its whole subtree with it —
  // otherwise its children would silently surface as a second root
  const refused = saturate(
    inc.nodes.filter((n) => mindmapLabelRejection(n.label) !== undefined).map((n) => n.id as string),
    (have) => inc.nodes.filter((n) => n.parent !== undefined && have.has(n.parent)).map((n) => n.id as string),
  );
  if (refused.has(incRoot.id)) return { reason: "nothing in the clipboard could be pasted here" };

  const anchor = mindmapRoot(ir)?.id;
  const map = new Map<string, MindmapNodeId>();
  for (const n of inc.nodes) if (!refused.has(n.id)) map.set(n.id, newId("mindmapNode"));

  const nodes: MindmapNode[] = inc.nodes
    .filter((n) => !refused.has(n.id))
    .map((n) => omitUndefined({ ...n, id: map.get(n.id)!, parent: n.parent === undefined ? anchor : map.get(n.parent) }));

  return { ir: { ...ir, nodes: [...ir.nodes, ...nodes] }, added: nodes.map((n) => n.id as string) };
}

export const mindmapClipboard: KindClipboard<MindmapIR> = { slice, merge };
