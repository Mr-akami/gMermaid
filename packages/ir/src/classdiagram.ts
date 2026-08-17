import type { ClassId, RelationId } from "./ids";

export type Visibility = "public" | "private" | "protected" | "package";

export interface ClassMember {
  readonly name: string;
  readonly type?: string;
  readonly visibility: Visibility;
}

export interface ClassMethod extends ClassMember {
  readonly params: string;
}

export interface ClassNode {
  readonly id: ClassId;
  readonly name: string;
  readonly stereotype?: string;
  readonly attributes: readonly ClassMember[];
  readonly methods: readonly ClassMethod[];
}

export type RelationType =
  | "inheritance"
  | "composition"
  | "aggregation"
  | "association"
  | "dependency"
  | "realization";

export interface ClassRelation {
  readonly id: RelationId;
  readonly from: ClassId;
  readonly to: ClassId;
  readonly type: RelationType;
  readonly label?: string;
  readonly fromCardinality?: string;
  readonly toCardinality?: string;
}

export interface ClassIR {
  readonly kind: "class";
  readonly classes: readonly ClassNode[];
  readonly relations: readonly ClassRelation[];
}

export function emptyClassDiagram(): ClassIR {
  return { kind: "class", classes: [], relations: [] };
}
