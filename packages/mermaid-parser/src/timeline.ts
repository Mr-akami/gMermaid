import type { EventId, PeriodId, SectionId, TimelineEvent, TimelineIR, TimelinePeriod, TimelineSection } from "@gmermaid/ir";
import { prepareLines, type ParseError, type ParseResult } from "./common";

// timeline: `title X`, `section X`, period lines `2002 : LinkedIn`, several
// events on one line (`2004 : Facebook : Google`) and continuation lines that
// start with `:` and attach to the period above. Mermaid's timeline text is
// raw — `#`, `<` and `>` are literal there — so the only text transform is
// `<br>` ↔ newline. Dialect the IR cannot hold is DISCARDED by design, same as
// `%%` comments: frontmatter, `%%{init}%%`, `accTitle` / `accDescr`, `;`.

const DROPPED = ["accTitle", "accDescr"];

/** Mermaid accepts `<br>`, `<br/>` and `<br />` as a line break. */
const BR_RE = /<br\s*\/?>/gi;

const toText = (raw: string): string => raw.trim().replaceAll(BR_RE, "\n");

export function parseTimeline(code: string): ParseResult<TimelineIR> {
  const errors: ParseError[] = [];
  const lines = prepareLines(code, { drop: DROPPED });

  const sections: TimelineSection[] = [];
  let title: string | undefined;
  let headerSeen = false;
  let sectionSeq = 0;
  let periodSeq = 0;
  let eventSeq = 0;

  // periods and events land in the section / period opened last
  let current: { section: TimelineSection; periods: TimelinePeriod[] } | undefined;
  let currentPeriod: { period: TimelinePeriod; events: TimelineEvent[] } | undefined;

  const closePeriod = (): void => {
    if (!currentPeriod) return;
    current!.periods.push({ ...currentPeriod.period, events: currentPeriod.events });
    currentPeriod = undefined;
  };
  const closeSection = (): void => {
    closePeriod();
    if (!current) return;
    sections.push({ ...current.section, periods: current.periods });
    current = undefined;
  };
  const openSection = (name: string): void => {
    closeSection();
    sectionSeq += 1;
    current = { section: { id: `section-${sectionSeq}` as SectionId, name, periods: [] }, periods: [] };
  };

  /** `a : b : c` → the events after the first separator, empties dropped
   * (mermaid rejects a bare trailing `:`; we simply carry no event). */
  const addEvents = (parts: readonly string[]): void => {
    for (const part of parts) {
      const text = toText(part);
      if (text === "") continue;
      eventSeq += 1;
      currentPeriod!.events.push({ id: `event-${eventSeq}` as EventId, text });
    }
  };

  for (const { text: line, line: lineNo } of lines) {
    if (!headerSeen) {
      if (line !== "timeline") {
        errors.push({ line: lineNo, message: "expected `timeline` header" });
        return { ok: false, errors };
      }
      headerSeen = true;
      continue;
    }

    const titleMatch = line.match(/^title(?:\s+(.*))?$/);
    if (titleMatch) {
      const t = toText(titleMatch[1] ?? "");
      if (t !== "") title = t;
      continue;
    }

    const sectionMatch = line.match(/^section(?:\s+(.*))?$/);
    if (sectionMatch) {
      const name = toText(sectionMatch[1] ?? "");
      if (name === "") {
        errors.push({ line: lineNo, message: "`section` needs a name" });
        continue;
      }
      if (name.includes(":")) {
        // mermaid's own parser crashes on `section A : B` — refuse rather
        // than build an IR that cannot be emitted back
        errors.push({ line: lineNo, message: "section name cannot contain `:`" });
        continue;
      }
      openSection(name);
      continue;
    }

    const parts = line.split(":");
    if (line.startsWith(":")) {
      // continuation: more events for the period above
      if (!currentPeriod) {
        errors.push({ line: lineNo, message: "event line before any period" });
        continue;
      }
      addEvents(parts.slice(1));
      continue;
    }

    const label = toText(parts[0]!);
    if (label === "") {
      errors.push({ line: lineNo, message: `cannot parse: ${line}` });
      continue;
    }
    // periods written before any `section` form one unnamed leading group
    if (!current) openSection("");
    closePeriod();
    periodSeq += 1;
    currentPeriod = { period: { id: `period-${periodSeq}` as PeriodId, label, events: [] }, events: [] };
    addEvents(parts.slice(1));
  }

  closeSection();

  if (!headerSeen) errors.push({ line: 1, message: "empty diagram: missing header" });
  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, ir: { kind: "timeline", ...(title !== undefined ? { title } : {}), sections } };
}
