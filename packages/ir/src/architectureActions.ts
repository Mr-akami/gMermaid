import type { ArchEdgeId, ArchGroupId, ArchServiceId } from "./ids";
import {
  archGroupChain,
  normalizeArchEdge,
  settleArchitecture,
  type ArchEdge,
  type ArchGroup,
  type ArchJunction,
  type ArchNodeId,
  type ArchService,
  type ArchSide,
  type ArchitectureIR,
} from "./architecture";
import { omitUndefined } from "./omitUndefined";

// Mermaid identifies groups, services and junctions by NAME out of one
// diagram-wide namespace, so a name is the exchange identity: mermaid-safe and
// unique across all three collections. Internal ids stay stable across
// renames; codegen maps id → name on export.
export const ARCH_NAME_RE = /^[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*$/;

/** Words the text claims for itself: statement keywords, the port letters
 * (`a:R` — a node called `R` could not be told from the side) and the
 * statements the parser drops. */
const ARCH_RESERVED = new Set([
  "group",
  "service",
  "junction",
  "in",
  "align",
  "row",
  "column",
  "title",
  "accTitle",
  "accDescr",
  "architecture-beta",
  "L",
  "R",
  "T",
  "B",
]);

/** Why `name` cannot name a group, service or junction, or undefined when it
 * can. Shared by the reducer (reject) and the UI (show the reason). */
export function archNameRejection(name: string): string | undefined {
  if (!ARCH_NAME_RE.test(name)) return "use letters, digits, `_` and `-` only";
  if (ARCH_RESERVED.has(name)) return `\`${name}\` is a mermaid keyword`;
  return undefined;
}

const ICON_RE = /^[\w:-]+$/;

/** Why `icon` is not an icon name mermaid reads (`(name)`), or undefined. */
export function archIconRejection(icon: string): string | undefined {
  return icon === "" || ICON_RE.test(icon) ? undefined : "use letters, digits, `_`, `-` and `:` only";
}

/** A label lives inside `["…"]` on one line. */
export function sanitizeArchLabel(label: string): string {
  return label.replaceAll(/\s*[\r\n]+\s*/g, " ").trim();
}

const norm = (v: string | undefined): string | undefined => {
  if (v === undefined) return undefined;
  const t = sanitizeArchLabel(v);
  return t === "" ? undefined : t;
};

export type ArchitectureAction =
  | { type: "addGroup"; group: ArchGroup }
  | { type: "addService"; service: ArchService }
  | { type: "addJunction"; junction: ArchJunction }
  /** a service or a junction; its edges go with it */
  | { type: "removeNode"; id: ArchNodeId }
  /** members and sub-groups move up to the removed group's parent */
  | { type: "removeGroup"; id: ArchGroupId }
  | { type: "rename"; id: ArchGroupId | ArchNodeId; name: string }
  | { type: "updateGroup"; id: ArchGroupId; label?: string; icon?: string }
  | { type: "updateService"; id: ArchServiceId; label?: string; icon?: string }
  /** membership: null = move out to the top level */
  | { type: "setNodeGroup"; id: ArchNodeId; group: ArchGroupId | null }
  | { type: "setGroupParent"; id: ArchGroupId; parent: ArchGroupId | null }
  | { type: "addEdge"; edge: ArchEdge }
  | { type: "removeEdge"; id: ArchEdgeId }
  /** Re-point an end, optionally with a new side, instead of redrawing the
   * edge (which loses its arrows and label). An omitted end keeps its node. */
  | { type: "retargetEdge"; id: ArchEdgeId; from?: ArchNodeId; to?: ArchNodeId }
  | {
      type: "updateEdge";
      id: ArchEdgeId;
      fromSide?: ArchSide;
      toSide?: ArchSide;
      arrowFrom?: boolean;
      arrowTo?: boolean;
      groupFrom?: boolean;
      groupTo?: boolean;
      label?: string;
    };

function nameTaken(ir: ArchitectureIR, name: string): boolean {
  return (
    ir.groups.some((g) => g.name === name) ||
    ir.services.some((s) => s.name === name) ||
    ir.junctions.some((j) => j.name === name)
  );
}

function idTaken(ir: ArchitectureIR, id: string): boolean {
  return ir.groups.some((g) => g.id === id) || ir.services.some((s) => s.id === id) || ir.junctions.some((j) => j.id === id);
}

const isNode = (ir: ArchitectureIR, id: string): boolean =>
  ir.services.some((s) => s.id === id) || ir.junctions.some((j) => j.id === id);

const hasGroup = (ir: ArchitectureIR, id: string | undefined): boolean => id === undefined || ir.groups.some((g) => g.id === id);

/**
 * Why edge `id` cannot be re-pointed at `ends`, or undefined when it can.
 * An omitted end means "keep the current one". Said once so the reducer
 * (which rejects) and the property window (which has to SHOW the refusal)
 * cannot drift apart. Only services and junctions are ends — mermaid has no
 * edge that names a group — and an edge cannot loop back onto one node.
 */
export function archEdgeRetargetRejection(
  ir: ArchitectureIR,
  id: ArchEdgeId,
  ends: { readonly from?: ArchNodeId; readonly to?: ArchNodeId },
): string | undefined {
  const e = ir.edges.find((x) => x.id === id);
  if (e === undefined) return "unknown edge";
  const from = ends.from ?? e.from;
  const to = ends.to ?? e.to;
  const reason = (end: ArchNodeId, which: string): string | undefined => {
    if (isNode(ir, end)) return undefined;
    return ir.groups.some((g) => (g.id as string) === (end as string))
      ? `an edge cannot attach to a group (${which}) — put {group} on a member instead`
      : `unknown ${which}`;
  };
  const bad = reason(from, "source") ?? reason(to, "target");
  if (bad !== undefined) return bad;
  return from === to ? "an edge cannot connect a node to itself" : undefined;
}

export function applyArchitectureAction(ir: ArchitectureIR, action: ArchitectureAction): ArchitectureIR {
  const next = reduce(ir, action);
  return next === ir ? ir : settleArchitecture(next);
}

function reduce(ir: ArchitectureIR, action: ArchitectureAction): ArchitectureIR {
  switch (action.type) {
    case "addGroup": {
      const g = action.group;
      if (idTaken(ir, g.id) || nameTaken(ir, g.name) || archNameRejection(g.name) !== undefined) return ir;
      if (!hasGroup(ir, g.parent)) return ir;
      if (g.icon !== undefined && archIconRejection(g.icon) !== undefined) return ir;
      return { ...ir, groups: [...ir.groups, omitUndefined({ ...g, label: norm(g.label), icon: norm(g.icon) })] };
    }

    case "addService": {
      const s = action.service;
      if (idTaken(ir, s.id) || nameTaken(ir, s.name) || archNameRejection(s.name) !== undefined) return ir;
      if (!hasGroup(ir, s.group)) return ir;
      if (s.icon !== undefined && archIconRejection(s.icon) !== undefined) return ir;
      return { ...ir, services: [...ir.services, omitUndefined({ ...s, label: norm(s.label), icon: norm(s.icon) })] };
    }

    case "addJunction": {
      const j = action.junction;
      if (idTaken(ir, j.id) || nameTaken(ir, j.name) || archNameRejection(j.name) !== undefined) return ir;
      if (!hasGroup(ir, j.group)) return ir;
      return { ...ir, junctions: [...ir.junctions, j] };
    }

    case "removeNode": {
      if (!isNode(ir, action.id)) return ir;
      return {
        ...ir,
        services: ir.services.filter((s) => s.id !== action.id),
        junctions: ir.junctions.filter((j) => j.id !== action.id),
        edges: ir.edges.filter((e) => e.from !== action.id && e.to !== action.id),
      };
    }

    case "removeGroup": {
      const g = ir.groups.find((x) => x.id === action.id);
      if (!g) return ir;
      const up = (x: ArchGroupId | undefined): ArchGroupId | undefined => (x === action.id ? g.parent : x);
      return {
        ...ir,
        groups: ir.groups.filter((x) => x.id !== action.id).map((x) => (x.parent === action.id ? omitUndefined({ ...x, parent: up(x.parent) }) : x)),
        services: ir.services.map((s) => (s.group === action.id ? omitUndefined({ ...s, group: up(s.group) }) : s)),
        junctions: ir.junctions.map((j) => (j.group === action.id ? omitUndefined({ ...j, group: up(j.group) }) : j)),
      };
    }

    case "rename": {
      const current =
        ir.groups.find((g) => g.id === action.id) ??
        ir.services.find((s) => s.id === action.id) ??
        ir.junctions.find((j) => j.id === action.id);
      if (!current || current.name === action.name) return ir;
      if (archNameRejection(action.name) !== undefined || nameTaken(ir, action.name)) return ir;
      const rename = <T extends { id: string; name: string }>(x: T): T => (x.id === action.id ? { ...x, name: action.name } : x);
      return { ...ir, groups: ir.groups.map(rename), services: ir.services.map(rename), junctions: ir.junctions.map(rename) };
    }

    case "updateGroup": {
      const g = ir.groups.find((x) => x.id === action.id);
      if (!g) return ir;
      if (action.icon !== undefined && archIconRejection(action.icon) !== undefined) return ir;
      const label = action.label !== undefined ? norm(action.label) : g.label;
      const icon = action.icon !== undefined ? norm(action.icon) : g.icon;
      if (label === g.label && icon === g.icon) return ir;
      return { ...ir, groups: ir.groups.map((x) => (x.id === action.id ? omitUndefined({ ...g, label, icon }) : x)) };
    }

    case "updateService": {
      const s = ir.services.find((x) => x.id === action.id);
      if (!s) return ir;
      if (action.icon !== undefined && archIconRejection(action.icon) !== undefined) return ir;
      const label = action.label !== undefined ? norm(action.label) : s.label;
      const icon = action.icon !== undefined ? norm(action.icon) : s.icon;
      if (label === s.label && icon === s.icon) return ir;
      return { ...ir, services: ir.services.map((x) => (x.id === action.id ? omitUndefined({ ...s, label, icon }) : x)) };
    }

    case "setNodeGroup": {
      if (!isNode(ir, action.id)) return ir;
      const group = action.group ?? undefined;
      if (!hasGroup(ir, group)) return ir;
      return {
        ...ir,
        services: ir.services.map((s) => (s.id === action.id ? omitUndefined({ ...s, group }) : s)),
        junctions: ir.junctions.map((j) => (j.id === action.id ? omitUndefined({ ...j, group }) : j)),
      };
    }

    case "setGroupParent": {
      const g = ir.groups.find((x) => x.id === action.id);
      if (!g) return ir;
      const parent = action.parent ?? undefined;
      if (!hasGroup(ir, parent)) return ir;
      // a group cannot sit inside itself or anything nested in it
      if (parent !== undefined && archGroupChain(ir, parent).includes(action.id)) return ir;
      if (g.parent === parent) return ir;
      return { ...ir, groups: ir.groups.map((x) => (x.id === action.id ? omitUndefined({ ...x, parent }) : x)) };
    }

    case "addEdge": {
      const e = action.edge;
      if (ir.edges.some((x) => x.id === e.id)) return ir;
      if (!isNode(ir, e.from) || !isNode(ir, e.to) || e.from === e.to) return ir;
      return { ...ir, edges: [...ir.edges, normalizeArchEdge(ir, omitUndefined({ ...e, label: norm(e.label) }))] };
    }

    case "removeEdge": {
      if (!ir.edges.some((e) => e.id === action.id)) return ir;
      return { ...ir, edges: ir.edges.filter((e) => e.id !== action.id) };
    }

    case "retargetEdge": {
      const e = ir.edges.find((x) => x.id === action.id);
      if (e === undefined || archEdgeRetargetRejection(ir, action.id, action) !== undefined) return ir;
      const from = action.from ?? e.from;
      const to = action.to ?? e.to;
      if (from === e.from && to === e.to) return ir;
      const moved = normalizeArchEdge(ir, { ...e, from, to });
      return { ...ir, edges: ir.edges.map((x) => (x.id === action.id ? moved : x)) };
    }

    case "updateEdge": {
      const e = ir.edges.find((x) => x.id === action.id);
      if (!e) return ir;
      const next = normalizeArchEdge(
        ir,
        omitUndefined({
          ...e,
          fromSide: action.fromSide ?? e.fromSide,
          toSide: action.toSide ?? e.toSide,
          arrowFrom: action.arrowFrom ?? e.arrowFrom,
          arrowTo: action.arrowTo ?? e.arrowTo,
          groupFrom: action.groupFrom !== undefined ? (action.groupFrom ? (true as const) : undefined) : e.groupFrom,
          groupTo: action.groupTo !== undefined ? (action.groupTo ? (true as const) : undefined) : e.groupTo,
          label: action.label !== undefined ? norm(action.label) : e.label,
        }),
      );
      const same =
        next.fromSide === e.fromSide &&
        next.toSide === e.toSide &&
        next.arrowFrom === e.arrowFrom &&
        next.arrowTo === e.arrowTo &&
        next.groupFrom === e.groupFrom &&
        next.groupTo === e.groupTo &&
        next.label === e.label;
      if (same) return ir;
      return { ...ir, edges: ir.edges.map((x) => (x.id === action.id ? next : x)) };
    }
  }
}
