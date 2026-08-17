import type { BranchId, FragmentId, LifelineId, MessageId, NoteId } from "./ids";

export interface Lifeline {
  readonly id: LifelineId;
  readonly name: string;
  readonly isActor: boolean;
}

export type MessageArrowType = "solid" | "dotted" | "solidOpen" | "dottedOpen" | "async";

export interface Message {
  readonly kind: "message";
  readonly id: MessageId;
  readonly from: LifelineId;
  readonly to: LifelineId;
  readonly label: string;
  readonly arrow: MessageArrowType;
}

export type FragmentKind = "alt" | "opt" | "loop" | "par";

/**
 * A combined fragment owns its events structurally: membership is defined by
 * which events sit inside which branch, never by coordinates. Dragging a
 * fragment border in the GUI is an IR restructure (move events in/out).
 */
export interface Fragment {
  readonly kind: "fragment";
  readonly id: FragmentId;
  readonly fragmentKind: FragmentKind;
  readonly branches: readonly Branch[];
}

export interface Branch {
  readonly id: BranchId;
  readonly condition: string;
  readonly events: readonly SequenceEvent[];
}

export type NotePosition = "leftOf" | "rightOf" | "over";

/** A comment box, ordered like any other event. When it directly follows a
 * message, the renderer draws a dotted reference line to that message. */
export interface Note {
  readonly kind: "note";
  readonly id: NoteId;
  readonly position: NotePosition;
  /** 1 lifeline for leftOf/rightOf; 1-2 for over. */
  readonly lifelines: readonly LifelineId[];
  readonly text: string;
}

export type SequenceEvent = Message | Fragment | Note;

export interface SequenceIR {
  readonly kind: "sequence";
  readonly lifelines: readonly Lifeline[];
  readonly events: readonly SequenceEvent[];
}

export function emptySequence(): SequenceIR {
  return { kind: "sequence", lifelines: [], events: [] };
}
