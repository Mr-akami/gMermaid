import { describe, expect, it } from "vitest";
import { STYLING_STATEMENTS } from "./common";
import { DIAGRAM_KINDS, parseDiagram, type DiagramKind } from "./registry";

// The drop policy is only worth anything if it is the SAME everywhere: one
// styling statement must not open in nine kinds and break the tenth.

/** A minimal, valid diagram of each kind, with a `%s` slot for one extra
 * statement (appended where that kind accepts a statement). */
const SAMPLE: Record<DiagramKind, (stmt: string) => string> = {
  flowchart: (s) => `flowchart TD\n  A[Hi] --> B[Yo]\n  ${s}\n`,
  sequence: (s) => `sequenceDiagram\n  participant A\n  participant B\n  A->>B: hi\n  ${s}\n`,
  class: (s) => `classDiagram\n  class A\n  class B\n  A --> B\n  ${s}\n`,
  state: (s) => `stateDiagram-v2\n  [*] --> A\n  A --> B\n  ${s}\n`,
  requirement: (s) =>
    `requirementDiagram\n  requirement A {\n  id: 1\n  text: t\n  risk: low\n  verifymethod: test\n  }\n  ${s}\n`,
  journey: (s) => `journey\n  title T\n  section S\n    Task: 5: Me\n  ${s}\n`,
  timeline: (s) => `timeline\n  title T\n  section S\n  2002 : x\n  ${s}\n`,
  gantt: (s) => `gantt\n  title T\n  dateFormat YYYY-MM-DD\n  section S\n  task1 :a1, 2024-01-01, 3d\n  ${s}\n`,
  mindmap: (s) => `mindmap\n  root((r))\n    a\n${s}\n`,
  usecase: (s) => `usecase-beta\n  actor A\n  A --> Checkout\n  ${s}\n`,
};

/** One real-world spelling per shared keyword. */
const STATEMENT: Record<string, string> = {
  accDescr: "accDescr: a description",
  accTitle: "accTitle: a title",
  class: "class A zz",
  classDef: "classDef zz fill:#f00",
  click: 'click A "https://example.com"',
  cssClass: 'cssClass "A" zz',
  linkStyle: "linkStyle 0 stroke:#f00",
  style: "style A fill:#f00",
};

/** `class` is a real statement in classDiagram (it DECLARES a class) and
 * ordinary prose in a mindmap node, so those two kinds keep it — the only
 * two exceptions to the shared set, and both are deliberate. */
const KEEPS: Partial<Record<DiagramKind, readonly string[]>> = { class: ["class"], mindmap: ["class"] };

describe("shared drop policy", () => {
  for (const kind of DIAGRAM_KINDS) {
    for (const keyword of STYLING_STATEMENTS) {
      if (KEEPS[kind]?.includes(keyword)) continue;
      it(`${kind} drops \`${keyword}\` and says so`, () => {
        const result = parseDiagram(kind, SAMPLE[kind](STATEMENT[keyword]!));
        expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
        if (!result.ok) return;
        expect(result.warnings.map((w) => w.message)).toContain(
          `\`${keyword}\` is not represented in the editor and will be lost on save`,
        );
      });
    }
  }

  it("keeps a clean diagram warning-free", () => {
    for (const kind of DIAGRAM_KINDS) {
      const result = parseDiagram(kind, SAMPLE[kind](""));
      expect(result.ok, kind).toBe(true);
      if (result.ok) expect(result.warnings, kind).toEqual([]);
    }
  });

  it("reports the ORIGINAL source line of each dropped statement", () => {
    const result = parseDiagram("flowchart", "---\ntitle: t\n---\n%% c\nflowchart TD\n  A --> B\n  classDef zz fill:#f00\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([
      { line: 7, message: "`classDef` is not represented in the editor and will be lost on save" },
    ]);
  });

  it("matches whole keywords, never prefixes", () => {
    const result = parseDiagram("flowchart", "flowchart TD\n  styleNode --> classy\n  classDefinition --> clicker\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
  });

  it("leaves free text that merely starts with a keyword alone", () => {
    // mermaid reads these as content, not styling — dropping them would be
    // exactly the silent corruption the drop policy is meant to prevent
    const cases: readonly [DiagramKind, string, string][] = [
      ["mindmap", "mindmap\n  root((r))\n    style guide\n", "style guide"],
      ["journey", "journey\n  section S\n    class: 5: Me\n", "class"],
      ["gantt", "gantt\n  dateFormat YYYY-MM-DD\n  section S\n  click :a1, 2024-01-01, 3d\n", "click"],
    ];
    for (const [kind, code] of cases) {
      const result = parseDiagram(kind, code);
      expect(result.ok, code).toBe(true);
      if (result.ok) expect(result.warnings, code).toEqual([]);
    }
  });
});
