import type { ClassId, NamespaceId, NoteId, RelationId } from "./ids";

export type Visibility = "public" | "private" | "protected" | "package";

export interface ClassMember {
  readonly name: string;
  readonly type?: string;
  readonly visibility: Visibility;
  /** mermaid `$` classifier — rendered underlined. */
  readonly static?: boolean;
}

export interface ClassMethod extends ClassMember {
  readonly params: string;
  /** mermaid `*` classifier — rendered in italics. */
  readonly abstract?: boolean;
}

export interface ClassNode {
  readonly id: ClassId;
  /** Exchange identity: mermaid addresses classes by name. */
  readonly name: string;
  /** Display text (`class X["Label"]`); absent = show the name. */
  readonly label?: string;
  /** Generic parameter (`class Square~Shape~`), displayed as `Square<Shape>`. */
  readonly generic?: string;
  /** `<<annotation>>` lines, in source order. */
  readonly stereotypes: readonly string[];
  readonly attributes: readonly ClassMember[];
  readonly methods: readonly ClassMethod[];
  readonly namespace?: NamespaceId;
}

export type RelationLine = "solid" | "dashed";

// One head per end; mermaid's named relation kinds decompose into line +
// head (`realization` = dashed + inheritance, `dependency` = dashed + arrow),
// which is why the IR does not keep a separate "type" field. `lollipop` is
// the `()` interface marker: mermaid still models both ends as classes.
export type RelationHead = "none" | "arrow" | "inheritance" | "composition" | "aggregation" | "lollipop";

export interface ClassRelation {
  readonly id: RelationId;
  readonly from: ClassId;
  readonly to: ClassId;
  readonly line: RelationLine;
  readonly headFrom: RelationHead;
  readonly headTo: RelationHead;
  readonly label?: string;
  readonly fromCardinality?: string;
  readonly toCardinality?: string;
}

export interface ClassNote {
  readonly id: NoteId;
  readonly text: string;
  /** absent = free-floating `note "…"` */
  readonly target?: ClassId;
}

/** Flat, one level: mermaid's nested/dotted namespaces are not modelled. */
export interface ClassNamespace {
  readonly id: NamespaceId;
  readonly name: string;
}

export type ClassDirection = "TB" | "LR" | "BT" | "RL";

export interface ClassIR {
  readonly kind: "class";
  /** absent = mermaid default (TB) */
  readonly direction?: ClassDirection;
  readonly classes: readonly ClassNode[];
  readonly relations: readonly ClassRelation[];
  readonly notes: readonly ClassNote[];
  readonly namespaces: readonly ClassNamespace[];
}

export function emptyClassDiagram(): ClassIR {
  return { kind: "class", classes: [], relations: [], notes: [], namespaces: [] };
}
