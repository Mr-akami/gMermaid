import type { BranchId, FragmentId, LifelineId, MessageId, NoteId } from "./ids";

export interface Lifeline {
  readonly id: LifelineId;
  readonly name: string;
  readonly isActor: boolean;
}

export type MessageArrowType =
  | "solid"
  | "dotted"
  | "solidOpen"
  | "dottedOpen"
  | "async"
  | "dottedAsync"
  | "cross"
  | "dottedCross"
  | "bidirectional"
  | "dottedBidirectional";

export interface Message {
  readonly kind: "message";
  readonly id: MessageId;
  readonly from: LifelineId;
  readonly to: LifelineId;
  readonly label: string;
  readonly arrow: MessageArrowType;
}

export type FragmentKind = "alt" | "opt" | "loop" | "par" | "break" | "critical";

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

/** Loop iteration bounds, held structurally so compose/decompose of the
 * mermaid text form `(min,max) exit` stays reversible. Kept as strings:
 * they are display text, and "" means the field is blank in the form. */
export interface LoopBounds {
  readonly min: string;
  readonly max: string;
}

export interface Branch {
  readonly id: BranchId;
  /** Exit/guard text only — never carries the `(min,max)` prefix; codegen
   * assembles it, and the one ambiguous decomposition lives in the parser. */
  readonly condition: string;
  readonly loopBounds?: LoopBounds;
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

/** `autonumber [start [step]]` — message numbering, assigned by layout. */
export interface Autonumber {
  readonly start: number;
  readonly step: number;
}

export interface SequenceIR {
  readonly kind: "sequence";
  readonly lifelines: readonly Lifeline[];
  readonly events: readonly SequenceEvent[];
  readonly autonumber?: Autonumber;
}

export function emptySequence(): SequenceIR {
  return { kind: "sequence", lifelines: [], events: [] };
}
