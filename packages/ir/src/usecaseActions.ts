import type { ActorId, BoundaryId, NoteId, UseCaseId, UsecaseRelationId } from "./ids";
import type {
  ActorVariant,
  BoundaryType,
  UseCase,
  UseCaseShape,
  UsecaseActor,
  UsecaseBoundary,
  UsecaseDirection,
  UsecaseHead,
  UsecaseIR,
  UsecaseNodeId,
  UsecaseNote,
  UsecaseRelation,
} from "./usecase";
import { omitUndefined } from "./omitUndefined";

// Mermaid identifies actors, use cases and boundaries by NAME out of one
// diagram-wide namespace, so a name is the exchange identity: mermaid-safe
// and unique across all three collections. The internal ids stay stable
// across renames; codegen maps id → name on export.
export const USECASE_NAME_RE = /^[A-Za-z0-9_]+$/;

const norm = (v: string | undefined): string | undefined => (v === "" ? undefined : v);
const flag = (v: boolean | undefined): true | undefined => (v === true ? true : undefined);

/**
 * Force a relation into a shape mermaid can actually spell:
 * - `include` / `extend` are the only dashed lines, carry no marker and no label;
 * - at most one end carries a marker (`-->` vs `<--`, never `<-->`);
 * - generalization exists in the `--|>` direction only, so a head-from
 *   generalization is stored as the mirrored relation instead;
 * - generalization carries no label.
 */
export function normalizeUsecaseRelation(r: UsecaseRelation): UsecaseRelation {
  let { from, to, headFrom, headTo } = r;
  if (r.kind !== undefined) {
    return omitUndefined({ ...r, line: "dashed" as const, headFrom: "none" as const, headTo: "none" as const, label: undefined });
  }
  if (headFrom === "inheritance") {
    [from, to] = [to, from];
    headTo = "inheritance";
    headFrom = "none";
  }
  if (headFrom !== "none" && headTo !== "none") headFrom = "none";
  const label = headTo === "inheritance" ? undefined : norm(r.label);
  return omitUndefined({ ...r, from, to, line: "solid" as const, headFrom, headTo, label });
}

/** Mermaid rejects a business slash on awesome actors and on rectangles. */
const actorBusiness = (variant: ActorVariant, business: boolean | undefined): true | undefined =>
  variant === "awesome" ? undefined : flag(business);
const useCaseBusiness = (shape: UseCaseShape, business: boolean | undefined): true | undefined =>
  shape === "rect" ? undefined : flag(business);

export type UsecaseAction =
  | { type: "addActor"; actor: UsecaseActor }
  | { type: "addUseCase"; usecase: UseCase }
  | { type: "addBoundary"; boundary: UsecaseBoundary }
  | { type: "removeNode"; id: UsecaseNodeId }
  | { type: "removeBoundary"; id: BoundaryId }
  | { type: "renameNode"; id: UsecaseNodeId; name: string }
  | { type: "renameBoundary"; id: BoundaryId; name: string }
  | { type: "updateActor"; id: ActorId; label?: string; variant?: ActorVariant; business?: boolean; stereotype?: string }
  | { type: "updateUseCase"; id: UseCaseId; label?: string; shape?: UseCaseShape; business?: boolean; stereotype?: string }
  | { type: "updateBoundary"; id: BoundaryId; label?: string; boundaryType?: BoundaryType }
  /** boundary membership: null = move out to the top level */
  | { type: "setNodeBoundary"; id: UsecaseNodeId; boundary: BoundaryId | null }
  | { type: "setDirection"; direction: UsecaseDirection }
  | { type: "addRelation"; relation: UsecaseRelation }
  | { type: "removeRelation"; id: UsecaseRelationId }
  | {
      type: "updateRelation";
      id: UsecaseRelationId;
      headFrom?: UsecaseHead;
      headTo?: UsecaseHead;
      label?: string;
      /** "" clears include/extend back to a plain association */
      relationKind?: "include" | "extend" | "";
    }
  | { type: "addNote"; note: UsecaseNote }
  | { type: "updateNote"; id: NoteId; text: string }
  | { type: "removeNote"; id: NoteId };

function nameTaken(ir: UsecaseIR, name: string): boolean {
  return (
    ir.actors.some((a) => a.name === name) ||
    ir.usecases.some((u) => u.name === name) ||
    ir.boundaries.some((b) => b.name === name)
  );
}

function idTaken(ir: UsecaseIR, id: string): boolean {
  return (
    ir.actors.some((a) => a.id === id) || ir.usecases.some((u) => u.id === id) || ir.boundaries.some((b) => b.id === id)
  );
}

const isNode = (ir: UsecaseIR, id: string): boolean =>
  ir.actors.some((a) => a.id === id) || ir.usecases.some((u) => u.id === id);

export function applyUsecaseAction(ir: UsecaseIR, action: UsecaseAction): UsecaseIR {
  switch (action.type) {
    case "addActor": {
      const a = action.actor;
      if (idTaken(ir, a.id) || nameTaken(ir, a.name) || !USECASE_NAME_RE.test(a.name)) return ir;
      if (a.boundary !== undefined && !ir.boundaries.some((b) => b.id === a.boundary)) return ir;
      return {
        ...ir,
        actors: [
          ...ir.actors,
          omitUndefined({
            ...a,
            label: norm(a.label),
            business: actorBusiness(a.variant, a.business),
            stereotype: norm(a.stereotype),
          }),
        ],
      };
    }

    case "addUseCase": {
      const u = action.usecase;
      if (idTaken(ir, u.id) || nameTaken(ir, u.name) || !USECASE_NAME_RE.test(u.name)) return ir;
      if (u.boundary !== undefined && !ir.boundaries.some((b) => b.id === u.boundary)) return ir;
      return {
        ...ir,
        usecases: [
          ...ir.usecases,
          omitUndefined({
            ...u,
            label: norm(u.label),
            business: useCaseBusiness(u.shape, u.business),
            stereotype: norm(u.stereotype),
          }),
        ],
      };
    }

    case "addBoundary": {
      const b = action.boundary;
      if (idTaken(ir, b.id) || nameTaken(ir, b.name) || !USECASE_NAME_RE.test(b.name)) return ir;
      return { ...ir, boundaries: [...ir.boundaries, omitUndefined({ ...b, label: norm(b.label) })] };
    }

    case "removeNode": {
      if (!isNode(ir, action.id)) return ir;
      return {
        ...ir,
        actors: ir.actors.filter((a) => a.id !== action.id),
        usecases: ir.usecases.filter((u) => u.id !== action.id),
        relations: ir.relations.filter((r) => r.from !== action.id && r.to !== action.id),
        notes: ir.notes.filter((n) => n.target !== action.id),
      };
    }

    case "removeBoundary": {
      if (!ir.boundaries.some((b) => b.id === action.id)) return ir;
      // members survive the frame — they just move back to the top level
      return {
        ...ir,
        boundaries: ir.boundaries.filter((b) => b.id !== action.id),
        actors: ir.actors.map((a) => (a.boundary === action.id ? omitUndefined({ ...a, boundary: undefined }) : a)),
        usecases: ir.usecases.map((u) => (u.boundary === action.id ? omitUndefined({ ...u, boundary: undefined }) : u)),
      };
    }

    case "renameNode": {
      const current = ir.actors.find((a) => a.id === action.id) ?? ir.usecases.find((u) => u.id === action.id);
      if (!current || current.name === action.name) return ir;
      if (!USECASE_NAME_RE.test(action.name) || nameTaken(ir, action.name)) return ir;
      return {
        ...ir,
        actors: ir.actors.map((a) => (a.id === action.id ? { ...a, name: action.name } : a)),
        usecases: ir.usecases.map((u) => (u.id === action.id ? { ...u, name: action.name } : u)),
      };
    }

    case "renameBoundary": {
      const b = ir.boundaries.find((x) => x.id === action.id);
      if (!b || b.name === action.name) return ir;
      if (!USECASE_NAME_RE.test(action.name) || nameTaken(ir, action.name)) return ir;
      return { ...ir, boundaries: ir.boundaries.map((x) => (x.id === action.id ? { ...x, name: action.name } : x)) };
    }

    case "updateActor": {
      const a = ir.actors.find((x) => x.id === action.id);
      if (!a) return ir;
      const variant = action.variant ?? a.variant;
      const next = omitUndefined({
        ...a,
        label: action.label !== undefined ? norm(action.label) : a.label,
        variant,
        business: actorBusiness(variant, action.business ?? a.business),
        stereotype: action.stereotype !== undefined ? norm(action.stereotype) : a.stereotype,
      });
      if (next.label === a.label && next.variant === a.variant && next.business === a.business && next.stereotype === a.stereotype) {
        return ir;
      }
      return { ...ir, actors: ir.actors.map((x) => (x.id === action.id ? next : x)) };
    }

    case "updateUseCase": {
      const u = ir.usecases.find((x) => x.id === action.id);
      if (!u) return ir;
      const shape = action.shape ?? u.shape;
      const next = omitUndefined({
        ...u,
        label: action.label !== undefined ? norm(action.label) : u.label,
        shape,
        business: useCaseBusiness(shape, action.business ?? u.business),
        stereotype: action.stereotype !== undefined ? norm(action.stereotype) : u.stereotype,
      });
      if (next.label === u.label && next.shape === u.shape && next.business === u.business && next.stereotype === u.stereotype) {
        return ir;
      }
      return { ...ir, usecases: ir.usecases.map((x) => (x.id === action.id ? next : x)) };
    }

    case "updateBoundary": {
      const b = ir.boundaries.find((x) => x.id === action.id);
      if (!b) return ir;
      const next = omitUndefined({
        ...b,
        label: action.label !== undefined ? norm(action.label) : b.label,
        type: action.boundaryType ?? b.type,
      });
      if (next.label === b.label && next.type === b.type) return ir;
      return { ...ir, boundaries: ir.boundaries.map((x) => (x.id === action.id ? next : x)) };
    }

    case "setNodeBoundary": {
      if (!isNode(ir, action.id)) return ir;
      const boundary = action.boundary ?? undefined;
      if (boundary !== undefined && !ir.boundaries.some((b) => b.id === boundary)) return ir;
      return {
        ...ir,
        actors: ir.actors.map((a) => (a.id === action.id ? omitUndefined({ ...a, boundary }) : a)),
        usecases: ir.usecases.map((u) => (u.id === action.id ? omitUndefined({ ...u, boundary }) : u)),
      };
    }

    case "setDirection":
      return ir.direction === action.direction ? ir : { ...ir, direction: action.direction };

    case "addRelation": {
      const r = action.relation;
      if (ir.relations.some((x) => x.id === r.id)) return ir;
      if (!isNode(ir, r.from) || !isNode(ir, r.to)) return ir;
      // self-relations are allowed; layout draws them as a detour off the node
      return { ...ir, relations: [...ir.relations, normalizeUsecaseRelation(r)] };
    }

    case "removeRelation": {
      if (!ir.relations.some((r) => r.id === action.id)) return ir;
      return { ...ir, relations: ir.relations.filter((r) => r.id !== action.id) };
    }

    case "updateRelation": {
      const r = ir.relations.find((x) => x.id === action.id);
      if (!r) return ir;
      const kind = action.relationKind !== undefined ? norm(action.relationKind) : r.kind;
      // a head set on one end always wins over the head on the other
      const headTo = action.headTo ?? (action.headFrom !== undefined && action.headFrom !== "none" ? "none" : r.headTo);
      const headFrom = action.headFrom ?? (action.headTo !== undefined && action.headTo !== "none" ? "none" : r.headFrom);
      const next = normalizeUsecaseRelation(
        omitUndefined({
          ...r,
          headFrom,
          headTo,
          label: action.label !== undefined ? norm(action.label) : r.label,
          kind: kind as UsecaseRelation["kind"],
        }),
      );
      if (
        next.from === r.from &&
        next.to === r.to &&
        next.line === r.line &&
        next.headFrom === r.headFrom &&
        next.headTo === r.headTo &&
        next.label === r.label &&
        next.kind === r.kind
      ) {
        return ir;
      }
      return { ...ir, relations: ir.relations.map((x) => (x.id === action.id ? next : x)) };
    }

    case "addNote": {
      const n = action.note;
      if (ir.notes.some((x) => x.id === n.id)) return ir;
      if (!isNode(ir, n.target)) return ir; // mermaid rejects notes on boundaries
      return { ...ir, notes: [...ir.notes, n] };
    }

    case "updateNote": {
      const n = ir.notes.find((x) => x.id === action.id);
      if (!n || n.text === action.text) return ir;
      return { ...ir, notes: ir.notes.map((x) => (x.id === action.id ? { ...x, text: action.text } : x)) };
    }

    case "removeNote": {
      if (!ir.notes.some((n) => n.id === action.id)) return ir;
      return { ...ir, notes: ir.notes.filter((n) => n.id !== action.id) };
    }
  }
}
