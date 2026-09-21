// Branded id types: ids survive IR → LayoutResult → DOM attributes → events → IR.
// The brand prevents mixing ids across element kinds at compile time.
declare const brand: unique symbol;
export type Id<K extends string> = string & { readonly [brand]: K };

export type NodeId = Id<"node">;
export type EdgeId = Id<"edge">;
export type LifelineId = Id<"lifeline">;
export type MessageId = Id<"message">;
export type FragmentId = Id<"fragment">;
export type BranchId = Id<"branch">;
export type NoteId = Id<"note">;
export type ActivationId = Id<"activation">;
export type LifecycleId = Id<"lifecycle">;
export type BoxId = Id<"box">;
export type ClassId = Id<"class">;
export type RelationId = Id<"relation">;
export type StateId = Id<"state">;
export type TransitionId = Id<"transition">;
export type SubgraphId = Id<"subgraph">;
export type NamespaceId = Id<"namespace">;
export type SectionId = Id<"section">;
export type PeriodId = Id<"period">;
export type EventId = Id<"event">;
export type TaskId = Id<"task">;
export type RequirementId = Id<"requirement">;
export type ElementId = Id<"element">;
export type ActorId = Id<"actor">;
export type UseCaseId = Id<"usecase">;
export type BoundaryId = Id<"boundary">;
export type UsecaseRelationId = Id<"usecaseRelation">;
export type MindmapNodeId = Id<"mindmapNode">;

export type AnyId =
  | NodeId
  | EdgeId
  | LifelineId
  | MessageId
  | FragmentId
  | BranchId
  | NoteId
  | ActivationId
  | LifecycleId
  | BoxId
  | ClassId
  | RelationId
  | StateId
  | TransitionId
  | SubgraphId
  | NamespaceId
  | SectionId
  | PeriodId
  | EventId
  | TaskId
  | RequirementId
  | ElementId
  | ActorId
  | UseCaseId
  | BoundaryId
  | UsecaseRelationId
  | MindmapNodeId;

/** Every element kind that mints ids. */
export type IdKind =
  | "node"
  | "edge"
  | "lifeline"
  | "message"
  | "fragment"
  | "branch"
  | "note"
  | "activation"
  | "lifecycle"
  | "box"
  | "class"
  | "relation"
  | "state"
  | "transition"
  | "subgraph"
  | "namespace"
  | "section"
  | "period"
  | "event"
  | "task"
  | "requirement"
  | "element"
  | "actor"
  | "usecase"
  | "usecaseRelation"
  | "boundary"
  | "mindmapNode";

/**
 * Text prefix per element kind. Ids are exchange identity: several kinds are
 * spelled verbatim in the mermaid text (`subgraph X["…"]`, `A --> X`), so an
 * id that *starts with a mermaid keyword* stops mermaid's lexer dead — which
 * is exactly what `subgraph-<hex>` did. Hence one rule for every kind: the
 * branded kind maps to a short prefix that is no mermaid keyword, and the
 * separator is `_`, because a `-` is illegal inside a state-diagram id.
 *
 * The table is the whole rule — `mermaid-codegen`'s reserved-word test holds
 * it against the keywords harvested from mermaid's own grammars, so a kind
 * added later cannot reintroduce the bug.
 */
export const ID_PREFIX = {
  node: "nod",
  edge: "edg",
  lifeline: "lfl",
  message: "msg",
  fragment: "frg",
  branch: "brn",
  note: "nte",
  activation: "atv",
  lifecycle: "lfc",
  box: "pbx",
  class: "cls",
  relation: "rln",
  state: "stt",
  transition: "trn",
  subgraph: "grp",
  namespace: "nsp",
  section: "sct",
  period: "prd",
  event: "evt",
  task: "tsk",
  requirement: "rqm",
  element: "elm",
  actor: "atr",
  usecase: "ucs",
  usecaseRelation: "ucr",
  boundary: "bnd",
  mindmapNode: "mmn",
} as const satisfies Record<IdKind, string>;

/**
 * Collision-proof id generation. Parser-imported diagrams carry their own
 * ids (user-written or `message-N` style), so generated ids must never be
 * able to collide with them — duplicated ids silently corrupt updates.
 */
export function newId<K extends IdKind>(kind: K): Id<K> {
  return `${ID_PREFIX[kind]}_${crypto.randomUUID().slice(0, 8)}` as Id<K>;
}

/** Kinds whose *name* mermaid's lexer claims as a keyword. Ids minted under
 * the old `<kind>-<hex>` scheme for these are unreadable to mermaid, so they
 * are repaired on import (see `repairedId`). */
const KEYWORD_KINDS: readonly IdKind[] = [
  "actor",
  "box",
  "class",
  "element",
  "namespace",
  "note",
  "requirement",
  "section",
  "state",
  "subgraph",
  "usecase",
];

// `<kind>-<8 hex>` — the shape newId minted before ID_PREFIX existed, and
// unmistakably ours: nothing else spells a kind word followed by a uuid head.
const LEGACY_ID_RE = new RegExp(`^(${KEYWORD_KINDS.join("|")})-([0-9a-f]{8})$`);

/**
 * The safe id an old, keyword-prefixed id becomes, or undefined when `raw` is
 * fine as it stands. Diagrams saved before ID_PREFIX hold ids like
 * `subgraph-a6bde494`; our own parser reads them back happily, so the editor
 * opens the file and then emits text mermaid rejects. Importers rename them
 * so that opening and re-saving repairs the file.
 *
 * Pure and injective — no per-import bookkeeping, so every reference to the
 * same old id lands on the same new one, and two old ids never meet.
 */
export function repairedId(raw: string): string | undefined {
  const m = LEGACY_ID_RE.exec(raw);
  return m === null ? undefined : `${ID_PREFIX[m[1] as IdKind]}_${m[2]}`;
}
