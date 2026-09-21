import type { JourneyIR, JourneySection, JourneyTask, SectionId, TaskId } from "@gmermaid/ir";
import { dropList, prepareLines, type ParseError, type ParseResult, type ParseWarning } from "./common";

// `journey`: `title X`, `section X`, and task lines `Name: score: A, B`.
// Mirrors mermaid's lexer: the task name is everything up to the FIRST `:`,
// the field after it is the score, the (optional) field after that is the
// comma-separated actor list; further `:` fields are ignored. `#` opens a
// comment anywhere, so a `#` line tail is discarded. Frontmatter, `%%`
// comments, `;` terminators, the shared styling statements and journey's
// `link` are dropped by design (see prepareLines) and reported as warnings.

const DROPPED = dropList({ extra: ["link"] });

export function parseJourney(code: string): ParseResult<JourneyIR> {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  const lines = prepareLines(code, { drop: DROPPED, warnings });

  let headerSeen = false;
  let title: string | undefined;
  const sections: { id: SectionId; name: string; tasks: JourneyTask[] }[] = [];
  let sectionSeq = 0;
  let taskSeq = 0;

  const openSection = (name: string): void => {
    sectionSeq += 1;
    sections.push({ id: `section-${sectionSeq}` as SectionId, name, tasks: [] });
  };

  for (const { text: raw, line: lineNo } of lines) {
    // mermaid treats `#` as a comment opener in journey text
    const hash = raw.indexOf("#");
    const line = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
    if (line === "") continue;

    if (!headerSeen) {
      if (line !== "journey") {
        errors.push({ line: lineNo, message: "expected `journey` header" });
        return { ok: false, errors };
      }
      headerSeen = true;
      continue;
    }

    const t = line.match(/^title\s+(.+)$/);
    if (t) {
      title = t[1]!.trim();
      continue;
    }

    const s = line.match(/^section\s+([^:]+)$/);
    if (s) {
      openSection(s[1]!.trim());
      continue;
    }

    const colon = line.indexOf(":");
    if (colon > 0) {
      const name = line.slice(0, colon).trim();
      const fields = line.slice(colon + 1).split(":");
      const scoreText = fields[0]!.trim();
      const score = Number(scoreText);
      if (scoreText === "" || !Number.isFinite(score)) {
        errors.push({ line: lineNo, message: `task score must be a number: ${line}` });
        continue;
      }
      const actors = (fields[1] ?? "")
        .split(",")
        .map((a) => a.trim())
        .filter((a) => a !== "");
      // tasks before any `section` line live in an implicit unnamed section
      if (sections.length === 0) openSection("");
      taskSeq += 1;
      sections[sections.length - 1]!.tasks.push({ id: `task-${taskSeq}` as TaskId, name, score, actors });
      continue;
    }

    errors.push({ line: lineNo, message: `cannot parse: ${line}` });
  }

  if (!headerSeen) errors.push({ line: 1, message: "empty diagram: missing header" });
  if (errors.length > 0) return { ok: false, errors };

  const out: JourneySection[] = sections.map((s) => ({ id: s.id, name: s.name, tasks: s.tasks }));
  return {
    ok: true,
    warnings,
    ir: { kind: "journey", ...(title !== undefined ? { title } : {}), sections: out },
  };
}
