import { omitUndefined } from "./omitUndefined";
import type { ArchEdgeId, ArchGroupId, ArchJunctionId, ArchServiceId } from "./ids";

// Architecture diagrams (`architecture-beta`, mermaid 11.1+): groups, services
// with icons, junctions and port-to-port edges. The PORT SIDE of each edge end
// (`a:R -- L:b`) is IR data — mermaid places nodes on a grid from it — while
// the coordinates themselves are never stored (CONTEXT.md: auto layout).
// `align` hints, `title` / accessibility statements and icon text have no GUI
// meaning here and are dropped on import, like `%%` comments.

/** Side of a node an edge leaves from / enters at. */
export const ARCH_SIDES = ["T", "B", "L", "R"] as const;
export type ArchSide = (typeof ARCH_SIDES)[number];

/** Icons mermaid ships; any other name (`logos:aws`) needs a registered icon
 * pack, which the editor cannot assume, so it is carried but drawn generically. */
export const ARCH_BUILTIN_ICONS = ["cloud", "database", "disk", "internet", "server"] as const;

export interface ArchGroup {
  readonly id: ArchGroupId;
  /** Mermaid's identifier for the element — the exchange identity. */
  readonly name: string;
  /** absent = no title is drawn (mermaid shows nothing without `[…]`) */
  readonly label?: string;
  readonly icon?: string;
  /** enclosing group; absent = top level */
  readonly parent?: ArchGroupId;
}

export interface ArchService {
  readonly id: ArchServiceId;
  readonly name: string;
  readonly label?: string;
  readonly icon?: string;
  readonly group?: ArchGroupId;
}

export interface ArchJunction {
  readonly id: ArchJunctionId;
  readonly name: string;
  readonly group?: ArchGroupId;
}

/** An edge end: services and junctions only. Mermaid has no edge that names a
 * group — an edge reaches a group's border through `{group}` on a member. */
export type ArchNodeId = ArchServiceId | ArchJunctionId;

export interface ArchEdge {
  readonly id: ArchEdgeId;
  readonly from: ArchNodeId;
  readonly to: ArchNodeId;
  readonly fromSide: ArchSide;
  readonly toSide: ArchSide;
  /** arrowhead at the source end (`<--`) */
  readonly arrowFrom: boolean;
  /** arrowhead at the target end (`-->`) */
  readonly arrowTo: boolean;
  /** `from{group}`: the edge ends on the border of the node's group */
  readonly groupFrom?: true;
  readonly groupTo?: true;
  readonly label?: string;
}

export interface ArchitectureIR {
  readonly kind: "architecture";
  readonly groups: readonly ArchGroup[];
  readonly services: readonly ArchService[];
  readonly junctions: readonly ArchJunction[];
  readonly edges: readonly ArchEdge[];
}

export function emptyArchitectureDiagram(): ArchitectureIR {
  return { kind: "architecture", groups: [], services: [], junctions: [], edges: [] };
}

/** The group a service or junction sits in, or undefined at the top level. */
export function archNodeGroup(ir: ArchitectureIR, id: string): ArchGroupId | undefined {
  return ir.services.find((s) => s.id === id)?.group ?? ir.junctions.find((j) => j.id === id)?.group;
}

/** `id` itself and every group that encloses it, innermost first. */
export function archGroupChain(ir: ArchitectureIR, id: ArchGroupId | undefined): ArchGroupId[] {
  const chain: ArchGroupId[] = [];
  let cur = id;
  while (cur !== undefined && !chain.includes(cur)) {
    chain.push(cur);
    cur = ir.groups.find((g) => g.id === cur)?.parent;
  }
  return chain;
}

/** Groups before the groups nested in them — mermaid registers a parent only
 * when it comes earlier in the text. Stable for diagrams that already are. */
export function archGroupsParentFirst(ir: ArchitectureIR): ArchGroup[] {
  const out: ArchGroup[] = [];
  const done = new Set<string>();
  const visit = (g: ArchGroup, trail: ReadonlySet<string>): void => {
    if (done.has(g.id) || trail.has(g.id)) return;
    const parent = g.parent === undefined ? undefined : ir.groups.find((x) => x.id === g.parent);
    if (parent !== undefined) visit(parent, new Set([...trail, g.id]));
    done.add(g.id);
    out.push(g);
  };
  for (const g of ir.groups) visit(g, new Set());
  return out;
}

/**
 * `{group}` makes an edge end on the border of its node's group. Mermaid
 * refuses it when the two ends sit in the same group (the edge then crosses no
 * border), and it means nothing on a node outside every group — so those
 * flags are dropped. Returns the same object when nothing changes.
 */
export function normalizeArchEdge(ir: ArchitectureIR, e: ArchEdge): ArchEdge {
  const gFrom = archNodeGroup(ir, e.from);
  const gTo = archNodeGroup(ir, e.to);
  const same = gFrom !== undefined && gFrom === gTo;
  const groupFrom = e.groupFrom === true && gFrom !== undefined && !same;
  const groupTo = e.groupTo === true && gTo !== undefined && !same;
  if ((e.groupFrom === true) === groupFrom && (e.groupTo === true) === groupTo) return e;
  return omitUndefined({ ...e, groupFrom: groupFrom ? (true as const) : undefined, groupTo: groupTo ? (true as const) : undefined });
}

/** Re-normalizes every edge after anything that can change group membership. */
export function settleArchitecture(ir: ArchitectureIR): ArchitectureIR {
  let changed = false;
  const edges = ir.edges.map((e) => {
    const n = normalizeArchEdge(ir, e);
    if (n !== e) changed = true;
    return n;
  });
  return changed ? { ...ir, edges } : ir;
}
