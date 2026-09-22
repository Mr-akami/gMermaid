import type { DiagramIR } from "@gmermaid/ir";

/** What merging a parsed clipboard sub-diagram into a target produced. */
export type MergeResult<T> = { readonly ir: T; readonly added: readonly string[] } | { readonly reason: string };

/**
 * One diagram kind's half of the clipboard: close a selection into a
 * standalone sub-diagram (`slice`), and graft a parsed sub-diagram onto a
 * target with fresh ids (`merge`). Both are pure.
 */
export interface KindClipboard<T extends DiagramIR> {
  /** The closed sub-IR for `ids`, or undefined when the selection cannot be
   * expressed as a diagram of this kind at all. */
  slice(ir: T, ids: ReadonlySet<string>): T | undefined;
  merge(ir: T, incoming: T): MergeResult<T>;
}

/**
 * The one uniqueness rule for every name that IS an identity in mermaid text.
 * Keep the name when it is free, else take the first free `_2`, `_3`, …
 * `_` and digits are inside every name grammar we have to satisfy
 * (`CLASS_NAME_RE`, `REQ_NAME_RE`, `USECASE_NAME_RE`, `GANTT_TASK_ID_RE`),
 * so one rule covers the lot. The caller owns `taken` and adds to it.
 */
export function uniqueName(name: string, taken: Set<string>): string {
  let candidate = name;
  for (let n = 2; taken.has(candidate); n++) candidate = `${name}_${n}`;
  taken.add(candidate);
  return candidate;
}

/** Grow `seed` under `step` until it stops growing. Every closure rule in
 * this package is a fixpoint of some kind. */
export function saturate<T>(seed: Iterable<T>, step: (have: Set<T>) => Iterable<T>): Set<T> {
  const have = new Set(seed);
  for (;;) {
    let grew = false;
    for (const x of step(have)) {
      if (!have.has(x)) {
        have.add(x);
        grew = true;
      }
    }
    if (!grew) return have;
  }
}
