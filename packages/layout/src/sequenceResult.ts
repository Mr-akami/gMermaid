import type { BranchId, FragmentId, FragmentKind, LifelineId, MessageArrowType, MessageId, NoteId, NotePosition } from "@gmermaid/ir";
import type { Point, Rect } from "./result";

export interface LifelineColumn {
  readonly id: LifelineId;
  readonly name: string;
  readonly isActor: boolean;
  readonly x: number; // center of the lifeline spine
  readonly headRect: Rect;
  readonly spineTop: number;
  readonly spineBottom: number;
}

export interface MessageRow {
  readonly id: MessageId;
  readonly fromX: number;
  readonly toX: number;
  readonly y: number;
  readonly label: string;
  readonly labelPos: Point;
  readonly arrow: MessageArrowType;
  /** Autonumber value, present when the diagram has numbering on. */
  readonly seq?: number;
}

export interface BranchBand {
  readonly id: BranchId;
  readonly condition: string;
  readonly conditionPos: Point;
  /** Divider line above this branch; absent on the first branch. */
  readonly dividerY?: number;
}

export interface FragmentFrame {
  readonly id: FragmentId;
  readonly fragmentKind: FragmentKind;
  readonly rect: Rect;
  /** The clickable "alt"/"loop" tab in the top-left corner. */
  readonly labelTab: Rect;
  readonly branches: readonly BranchBand[];
  readonly depth: number;
}

export interface NoteBox {
  readonly id: NoteId;
  readonly rect: Rect;
  readonly text: string;
  readonly position: NotePosition;
  /** Dotted reference line to the message this note annotates (the event it
   * directly follows), when there is one. */
  readonly anchor?: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number };
}

/** An insertion point between rows: drop targets for drag-reordering.
 * Mirrors ir's EventContainer, kept as plain data (ids only). */
export interface DropSlot {
  readonly container: { readonly kind: "root" } | { readonly kind: "branch"; readonly branchId: BranchId };
  readonly index: number;
  readonly y: number;
}

export interface SequenceLayout {
  readonly kind: "sequence";
  readonly size: { readonly w: number; readonly h: number };
  readonly lifelines: readonly LifelineColumn[];
  readonly messages: readonly MessageRow[];
  readonly fragments: readonly FragmentFrame[];
  readonly notes: readonly NoteBox[];
  readonly slots: readonly DropSlot[];
}
