import type { XValue } from "@gmermaid/ir";

// The hinge between the two projections: ONE string, the transition label,
// holds the event, the guard and the actions in the UML form mermaid state
// diagrams already use:
//
//     EVENT [guard] / action1, action2
//
// The alternative — storing the event/guard/actions as their own IR fields
// beside the label — would give the IR two opinions about the same thing, and
// ADR 0001's "one master" would only have moved one level down. So the label
// IS the master and both projections read it through this module.
//
// Spellings that are not an event name:
//   ""                 →  `always` (an eventless / completion transition)
//   "after 1000ms"     →  `after: { 1000: … }`
//   "after timeout"    →  `after: { timeout: … }` (a named delay)
//
// A guard or an action may carry `params` as a JSON argument list:
//   "SUBMIT [isValid({\"min\":3})] / log({\"level\":\"warn\"}), track"

/** One `{ type, params }` reference, as written in a label. */
export interface XRef {
  readonly type: string;
  readonly params?: XValue;
}

export interface TransitionSignature {
  /** Absent for `always` and for `after` transitions. */
  readonly event?: string;
  /** Present exactly for `after` transitions: ms, or a named delay. */
  readonly delay?: number | string;
  readonly guard?: XRef;
  readonly actions: readonly XRef[];
}

/** Object keys JavaScript accepts unquoted. Events are arbitrary strings
 * (`"user.updated"`, `"*"`), so most of them do not qualify. */
const NAME_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Index of the first `ch` at bracket depth 0 and outside a string, or -1. */
function findTop(text: string, from: number, stop: (c: string) => boolean): number {
  let depth = 0;
  let quote: string | undefined;
  for (let i = from; i < text.length; i++) {
    const c = text[i]!;
    if (quote !== undefined) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = undefined;
      continue;
    }
    // the stop character is tested FIRST: `[` opens the guard section and is
    // also a bracket, and the section marker wins
    if (depth === 0 && stop(c)) return i;
    if (c === '"' || c === "'") quote = c;
    else if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c)) depth -= 1;
  }
  return -1;
}

/** Split on `,` at depth 0, dropping empties. */
function splitTop(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (;;) {
    const at = findTop(text, start, (c) => c === ",");
    if (at < 0) break;
    parts.push(text.slice(start, at));
    start = at + 1;
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

/** `name` or `name(<json>)`. Malformed JSON degrades to a bare name rather
 * than failing: a label is free text and the user may just have typed a
 * parenthesis. */
export function parseRef(text: string): XRef {
  const t = text.trim();
  const open = t.indexOf("(");
  if (open < 0 || !t.endsWith(")")) return { type: t };
  const type = t.slice(0, open).trim();
  const inner = t.slice(open + 1, -1).trim();
  if (type === "") return { type: t };
  if (inner === "") return { type };
  try {
    return { type, params: JSON.parse(inner) as XValue };
  } catch {
    return { type: t };
  }
}

export function formatRef(ref: XRef): string {
  return ref.params === undefined ? ref.type : `${ref.type}(${JSON.stringify(ref.params)})`;
}

const AFTER_MS_RE = /^after\s+(\d+)ms$/;
const AFTER_NAMED_RE = /^after\s+([A-Za-z_$][A-Za-z0-9_$]*)$/;

/** Read a mermaid transition label as an XState transition signature. Never
 * fails: an unrecognisable label is simply the event name, because an event
 * in XState v5 may be any string. */
export function parseTransitionLabel(label: string | undefined): TransitionSignature {
  const text = (label ?? "").trim();
  const guardAt = findTop(text, 0, (c) => c === "[");
  const slashAt = findTop(text, 0, (c) => c === "/");
  const headEnd = Math.min(guardAt < 0 ? text.length : guardAt, slashAt < 0 ? text.length : slashAt);
  const head = text.slice(0, headEnd).trim();

  let guard: XRef | undefined;
  let actionsAt = slashAt;
  if (guardAt >= 0 && (slashAt < 0 || guardAt < slashAt)) {
    const close = findTop(text, guardAt + 1, (c) => c === "]");
    const end = close < 0 ? text.length : close;
    const inner = text.slice(guardAt + 1, end).trim();
    if (inner !== "") guard = parseRef(inner);
    actionsAt = findTop(text, end + 1, (c) => c === "/");
  }
  const actions = actionsAt >= 0 ? splitTop(text.slice(actionsAt + 1)).map(parseRef) : [];

  const ms = AFTER_MS_RE.exec(head);
  if (ms) return { delay: Number(ms[1]), ...(guard ? { guard } : {}), actions };
  const named = AFTER_NAMED_RE.exec(head);
  if (named) return { delay: named[1]!, ...(guard ? { guard } : {}), actions };
  return { ...(head !== "" ? { event: head } : {}), ...(guard ? { guard } : {}), actions };
}

/** The canonical label for a signature — the inverse of the reader, up to
 * whitespace. `undefined` when the transition says nothing at all (an
 * unlabelled mermaid arrow, i.e. `always`). */
export function formatTransitionLabel(sig: TransitionSignature): string | undefined {
  const head =
    sig.delay !== undefined
      ? typeof sig.delay === "number"
        ? `after ${sig.delay}ms`
        : `after ${sig.delay}`
      : (sig.event ?? "");
  const parts: string[] = [];
  if (head !== "") parts.push(head);
  if (sig.guard !== undefined) parts.push(`[${formatRef(sig.guard)}]`);
  if (sig.actions.length > 0) parts.push(`/ ${sig.actions.map(formatRef).join(", ")}`);
  const text = parts.join(" ");
  return text === "" ? undefined : text;
}

/** An entry/exit action list, as stored in the IR (one signature per entry). */
export function formatActionList(refs: readonly XRef[]): readonly string[] {
  return refs.map(formatRef);
}

export function parseActionList(sigs: readonly string[]): readonly XRef[] {
  return sigs.map(parseRef);
}

/** Emit `name` bare where JavaScript lets us, quoted otherwise. */
export function quoteKey(name: string): string {
  return NAME_RE.test(name) ? name : JSON.stringify(name);
}
