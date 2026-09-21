import type { ActivationId, BoxId, BranchId, FragmentId, LifecycleId, LifelineId, MessageId, NoteId } from "./ids";

/** mermaid participant types (`actor X` / `participant X@{ type: … }`).
 * Names are exactly what mermaid.js 11.16 accepts; `db` is a parser-side
 * alias for `database`. */
export type ParticipantKind =
  | "participant"
  | "actor"
  | "boundary"
  | "control"
  | "entity"
  | "database"
  | "collections"
  | "queue";

export const PARTICIPANT_KINDS: readonly ParticipantKind[] = [
  "participant",
  "actor",
  "boundary",
  "control",
  "entity",
  "database",
  "collections",
  "queue",
];

export interface Lifeline {
  readonly id: LifelineId;
  readonly name: string;
  readonly kind: ParticipantKind;
}

/** `box <color?> <Name> … end` — a named group of lifeline heads. Members
 * are kept contiguous in `lifelines` (the reducer moves a lifeline next to
 * its box mates) so the box is a single rect and codegen keeps order. */
export interface Box {
  readonly id: BoxId;
  readonly name: string;
  /** CSS color text as written (`rgb(…)`, `transparent`, a color name). */
  readonly color?: string;
  readonly lifelines: readonly LifelineId[];
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
  /** Suffix-form activation: `start` = `->>+` (activate the target),
   * `end` = `->>-` (deactivate the source). */
  readonly activate?: "start" | "end";
}

/** Standalone `activate X` / `deactivate X`. */
export interface Activation {
  readonly kind: "activation";
  readonly id: ActivationId;
  readonly lifeline: LifelineId;
  readonly on: boolean;
}

/** `create participant X` / `destroy X`, positioned right before the
 * message that references the lifeline (mermaid requires the next message
 * to involve it — we keep the position, mermaid enforces the rule). */
export interface CreateLifeline {
  readonly kind: "create";
  readonly id: LifecycleId;
  readonly lifeline: LifelineId;
}

export interface DestroyLifeline {
  readonly kind: "destroy";
  readonly id: LifecycleId;
  readonly lifeline: LifelineId;
}

// two interfaces, not one with a `"create" | "destroy"` kind: only separate
// constituents let TS narrow `e.kind === "create"` out of SequenceEvent
export type Lifecycle = CreateLifeline | DestroyLifeline;

/** `rect` is a fragment with no label tab: its single branch's `condition`
 * holds the fill color text (`rgb(…)` / `rgba(…)`). */
export type FragmentKind = "alt" | "opt" | "loop" | "par" | "break" | "critical" | "rect";

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

export type SequenceEvent = Message | Fragment | Note | Activation | CreateLifeline | DestroyLifeline;

/** `autonumber [start [step]]` — message numbering, assigned by layout. */
export interface Autonumber {
  readonly start: number;
  readonly step: number;
}

export interface SequenceIR {
  readonly kind: "sequence";
  readonly lifelines: readonly Lifeline[];
  readonly boxes: readonly Box[];
  readonly events: readonly SequenceEvent[];
  readonly autonumber?: Autonumber;
}

/** CSS colors `box`/`rect` accept. mermaid asks the browser (CSS.supports);
 * we have no DOM in the parser, so we recognise the functional/hex forms plus
 * the named colors a diagram realistically uses. Anything else is TITLE text.
 * Shared so codegen guards exactly the ambiguity the parser resolves. */
const NAMED_COLORS = new Set([
  "transparent", "white", "black", "red", "green", "blue", "yellow", "orange", "purple", "pink",
  "gray", "grey", "silver", "gold", "aqua", "cyan", "magenta", "lime", "maroon", "navy", "olive",
  "teal", "fuchsia", "beige", "brown", "coral", "crimson", "indigo", "ivory", "khaki", "lavender",
  "salmon", "tan", "tomato", "turquoise", "violet", "wheat", "lightblue", "lightgreen", "lightgray",
  "lightgrey", "lightyellow", "darkblue", "darkgreen", "darkred", "darkgray", "darkgrey",
]);

export function isColorToken(token: string): boolean {
  const t = token.toLowerCase();
  return /^#[0-9a-f]{3,8}$/.test(t) || /^(?:rgba?|hsla?)\s*\([^)]*\)$/.test(t) || NAMED_COLORS.has(t);
}

export function emptySequence(): SequenceIR {
  return { kind: "sequence", lifelines: [], boxes: [], events: [] };
}
