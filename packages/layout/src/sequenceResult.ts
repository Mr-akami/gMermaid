import type {
  BoxId,
  BranchId,
  FragmentId,
  FragmentKind,
  LifelineId,
  MessageArrowType,
  MessageId,
  NoteId,
  NotePosition,
  ParticipantKind,
} from "@gmermaid/ir";
import type { Point, Rect } from "./result";

export interface LifelineColumn {
  readonly id: LifelineId;
  readonly name: string;
  readonly kind: ParticipantKind;
  readonly x: number; // center of the lifeline spine
  readonly headRect: Rect;
  readonly spineTop: number;
  readonly spineBottom: number;
  /** `create participant X`: the head sits at the create row, not the top. */
  readonly created?: boolean;
  /** `destroy X`: the spine ends in a cross at spineBottom. */
  readonly destroyed?: boolean;
}

/** `box … end` frame drawn behind the heads of its member lifelines. */
export interface BoxFrame {
  readonly id: BoxId;
  readonly name: string;
  readonly color?: string;
  readonly rect: Rect;
  readonly labelPos: Point;
}

/** An activation bar on a lifeline spine. `depth` is the nesting level of
 * the activation stack; layout has already offset `rect.x` by it. */
export interface ActivationBar {
  readonly lifeline: LifelineId;
  readonly rect: Rect;
  readonly depth: number;
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
  /** `rect` fragments: the fill color, drawn instead of a label tab. */
  readonly fill?: string;
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
  readonly boxes: readonly BoxFrame[];
  readonly activations: readonly ActivationBar[];
  readonly messages: readonly MessageRow[];
  readonly fragments: readonly FragmentFrame[];
  readonly notes: readonly NoteBox[];
  readonly slots: readonly DropSlot[];
}
