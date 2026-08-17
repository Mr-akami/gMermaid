// Undo/redo as IR snapshot history (ADR 0001). IR immutability makes
// snapshots free — they are just references.
const MAX_HISTORY = 200;

export interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
}

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** Push a new state as one undo step. Call once per user transaction. */
export function commit<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h;
  const past = h.past.length >= MAX_HISTORY ? h.past.slice(1) : h.past;
  return { past: [...past, h.present], present: next, future: [] };
}

/**
 * Replace the present without creating an undo step. Used inside a user
 * transaction (typing in one focus session, one drag) after its first commit,
 * so the whole transaction undoes as a single step.
 */
export function coalesce<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h;
  return { past: h.past, present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1];
  if (prev === undefined) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  const next = h.future[0];
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
}
