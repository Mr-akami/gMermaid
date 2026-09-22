import {
  newId,
  newStateId,
  type DiagramIR,
  type FlowchartEdge,
  type FlowchartEndpoint,
  type FlowchartIR,
  type FlowchartNode,
  type FlowchartSubgraph,
  type MindmapIR,
  type MindmapNode,
  type MindmapNodeId,
  type NodeId,
  type StateId,
  type StateIR,
  type StateNode,
  type StateTransition,
  type SubgraphId,
  type TransitionId,
} from "@gmermaid/ir";
import { flowchartToMermaid, mindmapToMermaid, stateToMermaid } from "@gmermaid/mermaid-codegen";
import { detectDiagramKind, parseFlowchart, parseMindmap, parseStateDiagram } from "@gmermaid/mermaid-parser";

// ---------------------------------------------------------------------------
// TEMPORARY STAND-IN for the clipboard model being built on its own branch.
// The two exported signatures are the agreed interface; when that branch
// lands, delete this file and import `copySelection` / `pasteInto` from
// `@gmermaid/ir` instead — nothing else in the app has to change.
//
// The shape of the model is what matters here, and it is the whole point of
// carrying MERMAID TEXT rather than a private format: what you copy pastes
// into the code pane, into any other mermaid tool, and back onto a canvas.
// This stand-in implements flowchart, state and mindmap and says so plainly
// for the rest, rather than pretending to copy and producing nothing.
// ---------------------------------------------------------------------------

export type PasteResult =
  | { readonly ok: true; readonly ir: DiagramIR; readonly added: readonly string[] }
  | { readonly ok: false; readonly reason: string };

const UNSUPPORTED = "この図種のコピー＆ペーストはまだ使えません";

/** Mermaid text for `ids` alone, or undefined when there is nothing to copy. */
export function copySelection(ir: DiagramIR, ids: readonly string[]): string | undefined {
  if (ids.length === 0) return undefined;
  const picked = new Set(ids);
  switch (ir.kind) {
    case "flowchart":
      return copyFlowchart(ir, picked);
    case "state":
      return copyState(ir, picked);
    case "mindmap":
      return copyMindmap(ir, picked);
    default:
      return undefined;
  }
}

/** Merge `text` into `ir` under fresh ids, or say why it cannot be merged. */
export function pasteInto(ir: DiagramIR, text: string): PasteResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, reason: "クリップボードが空です" };
  const kind = detectDiagramKind(trimmed);
  if (kind === undefined) return { ok: false, reason: "Mermaid の図として読めないテキストです" };
  if (kind !== ir.kind) return { ok: false, reason: `${kind} の図なので、この図には貼り付けられません` };
  switch (ir.kind) {
    case "flowchart":
      return pasteFlowchart(ir, trimmed);
    case "state":
      return pasteState(ir, trimmed);
    case "mindmap":
      return pasteMindmap(ir, trimmed);
    default:
      return { ok: false, reason: UNSUPPORTED };
  }
}

// --- flowchart -------------------------------------------------------------

function copyFlowchart(ir: FlowchartIR, picked: ReadonlySet<string>): string | undefined {
  const subgraphs = ir.subgraphs.filter((s) => picked.has(s.id));
  const kept = new Set<string>(subgraphs.map((s) => s.id));
  // a picked subgraph brings its members, or the copy would be an empty frame
  const nodes = ir.nodes.filter((n) => picked.has(n.id) || (n.parent !== undefined && kept.has(n.parent)));
  for (const n of nodes) kept.add(n.id);
  if (kept.size === 0) return undefined;
  // an edge travels only when BOTH its ends do — a dangling edge is not text
  const edges = ir.edges.filter((e) => kept.has(e.from) && kept.has(e.to));
  const orphaned = <T extends { readonly parent?: SubgraphId }>(x: T): T =>
    x.parent !== undefined && !kept.has(x.parent) ? { ...x, parent: undefined } : x;
  return flowchartToMermaid({
    kind: "flowchart",
    direction: ir.direction,
    nodes: nodes.map(orphaned) as readonly FlowchartNode[],
    subgraphs: subgraphs.map(orphaned) as readonly FlowchartSubgraph[],
    edges,
  });
}

function pasteFlowchart(ir: FlowchartIR, text: string): PasteResult {
  const parsed = parseFlowchart(text);
  if (!parsed.ok) return { ok: false, reason: parsed.errors[0]?.message ?? "貼り付けたテキストを読めませんでした" };
  const rename = new Map<string, string>();
  for (const n of parsed.ir.nodes) rename.set(n.id, newId("node"));
  for (const s of parsed.ir.subgraphs) rename.set(s.id, newId("subgraph"));
  const to = (id: string): string => rename.get(id) ?? id;
  const nodes: FlowchartNode[] = parsed.ir.nodes.map((n) => ({
    ...n,
    id: to(n.id) as NodeId,
    ...(n.parent !== undefined ? { parent: to(n.parent) as SubgraphId } : {}),
  }));
  const subgraphs: FlowchartSubgraph[] = parsed.ir.subgraphs.map((s) => ({
    ...s,
    id: to(s.id) as SubgraphId,
    ...(s.parent !== undefined ? { parent: to(s.parent) as SubgraphId } : {}),
  }));
  const edges: FlowchartEdge[] = parsed.ir.edges.map((e) => ({
    ...e,
    id: newId("edge"),
    from: to(e.from) as FlowchartEndpoint,
    to: to(e.to) as FlowchartEndpoint,
  }));
  if (nodes.length === 0 && subgraphs.length === 0) return { ok: false, reason: "貼り付けるものがありません" };
  return {
    ok: true,
    ir: { ...ir, nodes: [...ir.nodes, ...nodes], subgraphs: [...ir.subgraphs, ...subgraphs], edges: [...ir.edges, ...edges] },
    added: [...subgraphs.map((s) => s.id), ...nodes.map((n) => n.id)],
  };
}

// --- state -----------------------------------------------------------------

function copyState(ir: StateIR, picked: ReadonlySet<string>): string | undefined {
  const kept = new Set<string>();
  for (const s of ir.states) {
    if (picked.has(s.id)) kept.add(s.id);
  }
  // a picked composite brings everything inside it
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of ir.states) {
      if (s.parent !== undefined && kept.has(s.parent) && !kept.has(s.id)) {
        kept.add(s.id);
        grew = true;
      }
    }
  }
  if (kept.size === 0) return undefined;
  const states = ir.states
    .filter((s) => kept.has(s.id))
    .map((s) => (s.parent !== undefined && !kept.has(s.parent) ? { ...s, parent: undefined, region: undefined } : s));
  const transitions = ir.transitions.filter((t) => kept.has(t.from) && kept.has(t.to));
  return stateToMermaid({
    kind: "state",
    ...(ir.direction !== undefined ? { direction: ir.direction } : {}),
    states: states as readonly StateNode[],
    transitions,
    notes: ir.notes.filter((n) => kept.has(n.target)),
  });
}

function pasteState(ir: StateIR, text: string): PasteResult {
  const parsed = parseStateDiagram(text);
  if (!parsed.ok) return { ok: false, reason: parsed.errors[0]?.message ?? "貼り付けたテキストを読めませんでした" };
  const rename = new Map<string, StateId>();
  for (const s of parsed.ir.states) rename.set(s.id, newStateId());
  const to = (id: StateId): StateId => rename.get(id) ?? id;
  const states: StateNode[] = parsed.ir.states.map((s) => ({
    ...s,
    id: to(s.id),
    ...(s.parent !== undefined ? { parent: to(s.parent) } : {}),
  }));
  const transitions: StateTransition[] = parsed.ir.transitions.map((t) => ({
    ...t,
    id: newId("transition") as TransitionId,
    from: to(t.from),
    to: to(t.to),
  }));
  if (states.length === 0) return { ok: false, reason: "貼り付けるものがありません" };
  return {
    ok: true,
    ir: { ...ir, states: [...ir.states, ...states], transitions: [...ir.transitions, ...transitions] },
    added: states.map((s) => s.id),
  };
}

// --- mindmap ---------------------------------------------------------------

/** A mindmap is one tree, so a copy is one subtree: the topmost picked node. */
function copyMindmap(ir: MindmapIR, picked: ReadonlySet<string>): string | undefined {
  const byId = new Map(ir.nodes.map((n) => [n.id, n]));
  const depth = (n: MindmapNode): number => {
    let d = 0;
    let cur = n.parent;
    while (cur !== undefined && d <= ir.nodes.length) {
      d += 1;
      cur = byId.get(cur)?.parent;
    }
    return d;
  };
  const roots = ir.nodes.filter((n) => picked.has(n.id)).toSorted((a, b) => depth(a) - depth(b));
  const root = roots[0];
  if (root === undefined) return undefined;
  const kept = new Set<MindmapNodeId>([root.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of ir.nodes) {
      if (n.parent !== undefined && kept.has(n.parent) && !kept.has(n.id)) {
        kept.add(n.id);
        grew = true;
      }
    }
  }
  const nodes = ir.nodes
    .filter((n) => kept.has(n.id))
    .map((n) => (n.id === root.id ? { ...n, parent: undefined } : n));
  return mindmapToMermaid({ kind: "mindmap", nodes: nodes as readonly MindmapNode[] });
}

function pasteMindmap(ir: MindmapIR, text: string): PasteResult {
  const parsed = parseMindmap(text);
  if (!parsed.ok) return { ok: false, reason: parsed.errors[0]?.message ?? "貼り付けたテキストを読めませんでした" };
  const host = ir.nodes.find((n) => n.parent === undefined);
  if (host === undefined) return { ok: false, reason: "貼り付け先のルートノードがありません" };
  const rename = new Map<MindmapNodeId, MindmapNodeId>();
  for (const n of parsed.ir.nodes) rename.set(n.id, newId("mindmapNode"));
  const to = (id: MindmapNodeId): MindmapNodeId => rename.get(id) ?? id;
  // the pasted tree's own root hangs off the host root — a mindmap has one
  const nodes: MindmapNode[] = parsed.ir.nodes.map((n) => ({
    ...n,
    id: to(n.id),
    parent: n.parent === undefined ? host.id : to(n.parent),
  }));
  if (nodes.length === 0) return { ok: false, reason: "貼り付けるものがありません" };
  return { ok: true, ir: { ...ir, nodes: [...ir.nodes, ...nodes] }, added: nodes.map((n) => n.id) };
}
