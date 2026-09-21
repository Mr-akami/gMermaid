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
 * `:` splits the task fields, `#` opens a comment, `;` ends a statement,
 * `%%` opens a comment that swallows the rest of the line and `,` separates
 * actors — none can survive a text round trip, so they are removed at the IR
 * boundary (GUI input).
 *
 * `%%` is stripped last: dropping a `:` can push two lone `%` together. */
export function sanitizeJourneyText(text: string, opts: { readonly actor?: boolean } = {}): string {
  let cleaned = text.replaceAll(/[:#;\r\n]/g, "");
  if (opts.actor) cleaned = cleaned.replaceAll(",", "");
  return cleaned.replaceAll(/%%+/g, "").replaceAll(/\s+/g, " ").trim();
}

/** A task line is `<name>: <score>: <actors>`, but mermaid reads a line
 * opening with `title ` as the chart title first — such a task would be
 * swallowed whole and would overwrite the title. Nothing else collides:
 * `section X` still carries a `:` and stays a task. Shared by the reducer
 * (reject) and the UI (show the reason). */
export function journeyTaskNameRejection(name: string): string | undefined {
  if (sanitizeJourneyText(name) === "") return "task name cannot be empty";
  if (/^title(\s|$)/.test(sanitizeJourneyText(name))) return "a task name cannot start with `title` (mermaid keyword)";
  return undefined;
}

/** Actors in first-appearance order — drives legend order and colours. */
export function journeyActors(ir: JourneyIR): readonly string[] {
  const seen: string[] = [];
  for (const s of ir.sections) for (const t of s.tasks) for (const a of t.actors) if (!seen.includes(a)) seen.push(a);
  return seen;
}
