import type { SectionId, TaskId } from "./ids";

// User journey (`journey`): a title, sections, and tasks scored 1..5 by the
// actors who perform them. Mermaid's grammar has no ids for sections or
// tasks — they are positional in the text — so the IR ids are internal only
// (parser assigns `section-N` / `task-N`, the GUI mints random ones).

export interface JourneyTask {
  readonly id: TaskId;
  readonly name: string;
  /** Mermaid accepts any number here; the GUI restricts to 1..5. */
  readonly score: number;
  readonly actors: readonly string[];
}

export interface JourneySection {
  readonly id: SectionId;
  /** Empty = the implicit section holding tasks written before any
   * `section` line. Only meaningful as the FIRST section. */
  readonly name: string;
  readonly tasks: readonly JourneyTask[];
}

export interface JourneyIR {
  readonly kind: "journey";
  readonly title?: string;
  readonly sections: readonly JourneySection[];
}

export function emptyJourney(): JourneyIR {
  return { kind: "journey", sections: [] };
}

/** Task / section / actor names and the title are free text in mermaid, but
 * `:` splits the task fields, `#` opens a comment, `;` ends a statement and
 * `,` separates actors — none can survive a text round trip, so they are
 * removed at the IR boundary (GUI input). */
export function sanitizeJourneyText(text: string, opts: { readonly actor?: boolean } = {}): string {
  let cleaned = text.replaceAll(/[:#;\r\n]/g, "");
  if (opts.actor) cleaned = cleaned.replaceAll(",", "");
  return cleaned.replaceAll(/\s+/g, " ").trim();
}

/** Actors in first-appearance order — drives legend order and colours. */
export function journeyActors(ir: JourneyIR): readonly string[] {
  const seen: string[] = [];
  for (const s of ir.sections) for (const t of s.tasks) for (const a of t.actors) if (!seen.includes(a)) seen.push(a);
  return seen;
}
