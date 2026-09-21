import type { ActorId, BoundaryId, NoteId, UseCaseId, UsecaseRelationId } from "./ids";

// Use case diagrams (`usecase-beta`, mermaid 12+): actors, use cases, system
// boundaries, relationships and notes. Icon actors, edge ids, edge animation,
// extra-dash edge length, `json` tables and styling (`classDef` / `class` /
// `style` / `:::`) have no GUI meaning here and are dropped on import, the
// same way `%%` comments are.

export const ACTOR_VARIANTS = ["default", "hollow", "awesome"] as const;
export type ActorVariant = (typeof ACTOR_VARIANTS)[number];

export interface UsecaseActor {
  readonly id: ActorId;
  /** Mermaid's identifier for the element — the exchange identity. */
  readonly name: string;
  /** absent = mermaid displays the name */
  readonly label?: string;
  readonly variant: ActorVariant;
  /** the conventional business slash; mermaid rejects it on awesome actors */
  readonly business?: boolean;
  readonly stereotype?: string;
  readonly boundary?: BoundaryId;
}

export const USE_CASE_SHAPES = ["ellipse", "rect"] as const;
export type UseCaseShape = (typeof USE_CASE_SHAPES)[number];

export interface UseCase {
  readonly id: UseCaseId;
  readonly name: string;
  readonly label?: string;
  readonly shape: UseCaseShape;
  /** mermaid rejects business on rectangular use cases */
  readonly business?: boolean;
  readonly stereotype?: string;
  readonly boundary?: BoundaryId;
}

export const BOUNDARY_TYPES = ["default", "package"] as const;
export type BoundaryType = (typeof BOUNDARY_TYPES)[number];

export interface UsecaseBoundary {
  readonly id: BoundaryId;
  readonly name: string;
  readonly label?: string;
  readonly type: BoundaryType;
}

/** Either end of a relation. Mermaid shares one id namespace for both. */
export type UsecaseNodeId = ActorId | UseCaseId;

/** Marker at one end of a relation. Mermaid puts a marker on ONE end only:
 * `-->`, `<--`, `--o`, `o--`, `--x`, `x--`, `--|>`. */
export const USECASE_HEADS = ["none", "arrow", "circle", "cross", "inheritance"] as const;
export type UsecaseHead = (typeof USECASE_HEADS)[number];

export interface UsecaseRelation {
  readonly id: UsecaseRelationId;
  readonly from: UsecaseNodeId;
  readonly to: UsecaseNodeId;
  /** dashed exists only as `..> : include|extend` — hence tied to `kind` */
  readonly line: "solid" | "dashed";
  readonly headFrom: UsecaseHead;
  readonly headTo: UsecaseHead;
  /** only plain solid associations carry a label in mermaid */
  readonly label?: string;
  readonly kind?: "include" | "extend";
}

export interface UsecaseNote {
  readonly id: NoteId;
  readonly target: UsecaseNodeId;
  readonly text: string;
}

export type UsecaseDirection = "TB" | "LR" | "BT" | "RL";

export interface UsecaseIR {
  readonly kind: "usecase";
  /** absent = mermaid default */
  readonly direction?: UsecaseDirection;
  readonly actors: readonly UsecaseActor[];
  readonly usecases: readonly UseCase[];
  readonly boundaries: readonly UsecaseBoundary[];
  readonly relations: readonly UsecaseRelation[];
  readonly notes: readonly UsecaseNote[];
}

export function emptyUsecaseDiagram(): UsecaseIR {
  return { kind: "usecase", actors: [], usecases: [], boundaries: [], relations: [], notes: [] };
}
