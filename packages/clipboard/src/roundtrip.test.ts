import { describe, expect, it } from "vitest";
import type { DiagramIR } from "@gmermaid/ir";
import { ID_PREFIX } from "@gmermaid/ir";
import { parseDiagram, type DiagramKind } from "@gmermaid/mermaid-parser";
import {
  classToMermaid,
  flowchartToMermaid,
  ganttToMermaid,
  journeyToMermaid,
  mindmapToMermaid,
  requirementToMermaid,
  sequenceToMermaid,
  stateToMermaid,
  timelineToMermaid,
  usecaseToMermaid,
} from "@gmermaid/mermaid-codegen";
import { copySelection, pasteInto } from "./clipboard";
import { FIXTURES } from "./fixtures";

// The clipboard carries mermaid text, so the property under test is a TEXT
// property: what `copySelection` writes, `pasteInto` reads back into the
// same thing — modulo the ids it mints fresh and the `_2` suffix it hangs
// on names that must stay unique.

function emit(ir: DiagramIR): string {
  switch (ir.kind) {
    case "flowchart":
      return flowchartToMermaid(ir);
    case "sequence":
      return sequenceToMermaid(ir);
    case "class":
      return classToMermaid(ir);
    case "state":
      return stateToMermaid(ir);
    case "requirement":
      return requirementToMermaid(ir);
    case "journey":
      return journeyToMermaid(ir);
    case "timeline":
      return timelineToMermaid(ir);
    case "gantt":
      return ganttToMermaid(ir);
    case "mindmap":
      return mindmapToMermaid(ir);
    case "usecase":
      return usecaseToMermaid(ir);
  }
}

// no leading `\b`: mermaid's `-x` arrow abuts the id it points at, and a
// word boundary would not fire between the `x` and the prefix
const GENERATED_ID = new RegExp(String.raw`(?:${Object.values(ID_PREFIX).join("|")})_[0-9a-f]{8}(?![\w])`, "g");

/** Number every generated id by first appearance, so two texts can be
 * compared modulo ids that are minted fresh on every paste. */
function canon(text: string): string {
  const seen = new Map<string, string>();
  return text.replaceAll(GENERATED_ID, (m) => {
    const hit = seen.get(m);
    if (hit !== undefined) return hit;
    const next = `#${seen.size + 1}`;
    seen.set(m, next);
    return next;
  });
}

/** Every `id` anywhere in an IR, however deeply nested. */
function idsOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const x of value) idsOf(x, out);
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "id" && typeof v === "string") out.add(v);
      else idsOf(v, out);
    }
  }
  return out;
}

function parses(kind: DiagramKind, text: string): void {
  const result = parseDiagram(kind, text);
  expect(result.ok ? [] : result.errors, text).toEqual([]);
}

describe.each(FIXTURES)("$name", (fixture) => {
  const kind = fixture.ir.kind as DiagramKind;

  it.each(fixture.selections)("copies %s as mermaid our own parser reads back", (_label, ids) => {
    const text = copySelection(fixture.ir, ids);
    expect(text).toBeDefined();
    parses(kind, text!);
  });

  it.each(fixture.selections)("round trips %s through an empty diagram", (_label, ids) => {
    const text = copySelection(fixture.ir, ids)!;
    const pasted = pasteInto(fixture.empty, text);
    expect(pasted.ok ? "" : pasted.reason).toBe("");
    if (!pasted.ok) return;

    // parse(codegen(paste(copy(…)))) — the whole loop, and the text it lands
    // on is the text it started from
    const again = emit(pasted.ir);
    parses(kind, again);
    expect(canon(again)).toBe(canon(text));

    // and `added` really names the copy: re-copying exactly those ids writes
    // the same text again
    const copyOfCopy = copySelection(pasted.ir, pasted.added);
    expect(copyOfCopy).toBeDefined();
    expect(canon(copyOfCopy!)).toBe(canon(text));
  });

  it.each(fixture.selections)("pastes %s back next to the original", (_label, ids) => {
    const text = copySelection(fixture.ir, ids)!;
    const pasted = pasteInto(fixture.ir, text);
    expect(pasted.ok ? "" : pasted.reason).toBe("");
    if (!pasted.ok) return;

    parses(kind, emit(pasted.ir));
    expect(pasted.added.length).toBeGreaterThan(0);
    expect(new Set(pasted.added).size).toBe(pasted.added.length);

    // nothing already in the diagram was displaced, and nothing the paste
    // reports as new collided with it
    const before = idsOf(fixture.ir);
    const after = idsOf(pasted.ir);
    for (const id of before) expect(after.has(id), id).toBe(true);
    for (const id of pasted.added) expect(after.has(id), id).toBe(true);
    // the one exception: a `[*]` merges with the one already there
    const reused = pasted.added.filter((x) => before.has(x));
    expect(reused).toEqual([]);
  });

  it.each(fixture.selections)("pastes %s twice as two copies, not one", (_label, ids) => {
    const text = copySelection(fixture.ir, ids)!;
    const once = pasteInto(fixture.ir, text);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = pasteInto(once.ir, text);
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;

    // nothing minted the second time collided with the first
    expect(once.added.some((x) => twice.added.includes(x))).toBe(false);
    expect(twice.added.length).toBe(once.added.length);
    parses(kind, emit(twice.ir));
  });
});
