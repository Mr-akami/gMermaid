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
export type ClassId = Id<"class">;
export type RelationId = Id<"relation">;

export type AnyId =
  | NodeId
  | EdgeId
  | LifelineId
  | MessageId
  | FragmentId
  | BranchId
  | NoteId
  | ClassId
  | RelationId;

/**
 * Collision-proof id generation. Parser-imported diagrams carry their own
 * ids (user-written or `message-N` style), so generated ids must never be
 * able to collide with them — duplicated ids silently corrupt updates.
 */
export function newId<K extends string>(kind: K): Id<K> {
  return `${kind}-${crypto.randomUUID().slice(0, 8)}` as Id<K>;
}
