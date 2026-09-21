import { describe, expect, it } from "vitest";
import { timelineToMermaid } from "@gmermaid/mermaid-codegen";
import { parseTimeline } from "./timeline";

const shape = (code: string) => {
  const r = parseTimeline(code);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.ir.sections.map((s) => [s.name, s.periods.map((p) => [p.label, p.events.map((e) => e.text)])]);
};

/** parse → codegen → parse must land on the same IR, and codegen must be stable. */
const expectRoundTrip = (code: string) => {
  const first = parseTimeline(code);
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  const regen = timelineToMermaid(first.ir);
  const back = parseTimeline(regen);
  expect(back.ok).toBe(true);
  if (!back.ok) return;
  expect(back.ir).toEqual(first.ir);
  expect(timelineToMermaid(back.ir)).toBe(regen);
};

describe("parseTimeline", () => {
  it("parses the docs sample: title, periods, several events and continuation lines", () => {
    const code = `timeline
    title History of Social Media Platform
    2002 : LinkedIn
    2004 : Facebook : Google
    2005 : YouTube
    2006 : Twitter
`;
    const result = parseTimeline(code);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.title).toBe("History of Social Media Platform");
    // periods before any `section` form one unnamed leading group
    expect(result.ir.sections).toHaveLength(1);
    expect(result.ir.sections[0]!.name).toBe("");
    expect(shape(code)).toEqual([
      [
        "",
        [
          ["2002", ["LinkedIn"]],
          ["2004", ["Facebook", "Google"]],
          ["2005", ["YouTube"]],
          ["2006", ["Twitter"]],
        ],
      ],
    ]);
    expectRoundTrip(code);
  });

  it("reads continuation lines as more events of the period above", () => {
    const code = `timeline
    2004 : Facebook
         : Google
         : Flickr
    2005 : YouTube
`;
    expect(shape(code)).toEqual([
      [
        "",
        [
          ["2004", ["Facebook", "Google", "Flickr"]],
          ["2005", ["YouTube"]],
        ],
      ],
    ]);
    // codegen folds them back onto one line — the canonical form
    const parsed = parseTimeline(code);
    if (!parsed.ok) throw new Error("unparsed");
    expect(timelineToMermaid(parsed.ir)).toContain("2004 : Facebook : Google : Flickr");
    expectRoundTrip(code);
  });

  it("groups periods under sections and keeps a period without events", () => {
    const code = `timeline
    title Timeline of Industrial Revolution
    section 17th-20th century
        Industry 1.0 : Machinery, Water power, Steam <br>power
        Industry 2.0 : Electricity
    section 21st century
        Industry 4.0
`;
    expect(shape(code)).toEqual([
      [
        "17th-20th century",
        [
          ["Industry 1.0", ["Machinery, Water power, Steam \npower"]],
          ["Industry 2.0", ["Electricity"]],
        ],
      ],
      ["21st century", [["Industry 4.0", []]]],
    ]);
    expectRoundTrip(code);
  });

  it("tolerates frontmatter, comments, `;` and accessibility statements", () => {
    const code = `---
title: ignored
---
%%{init: {"theme":"dark"}}%%
timeline
  %% a comment
  accTitle: an accessible title
  title Kept
  2002 : LinkedIn %% trailing comment
  2003 : MySpace;
`;
    expect(shape(code)).toEqual([
      ["", [["2002", ["LinkedIn"]], ["2003", ["MySpace"]]]],
    ]);
    expectRoundTrip(code);
  });

  it("round trips unicode text and a `<br/>` line break", () => {
    const code = `timeline
  title 日本の元号
  section 期間
    平成 : 出来事 : 二つめ<br/>の行
`;
    expect(shape(code)).toEqual([["期間", [["平成", ["出来事", "二つめ\nの行"]]]]]);
    expectRoundTrip(code);
  });

  it("reports a missing header, a nameless section, `:` in a section name and an orphan event line", () => {
    expect(parseTimeline("pie\n 1 : a").ok).toBe(false);
    const nameless = parseTimeline("timeline\n  section\n");
    expect(nameless.ok).toBe(false);
    if (!nameless.ok) expect(nameless.errors[0]!.message).toMatch(/needs a name/);
    const colon = parseTimeline("timeline\n  section A : B\n");
    expect(colon.ok).toBe(false);
    if (!colon.ok) expect(colon.errors[0]!.message).toMatch(/cannot contain/);
    const orphan = parseTimeline("timeline\n  : stray\n");
    expect(orphan.ok).toBe(false);
    if (!orphan.ok) expect(orphan.errors[0]!.message).toMatch(/before any period/);
  });

  it("accepts an empty timeline and an empty section", () => {
    expect(parseTimeline("timeline\n")).toEqual({ ok: true, warnings: [], ir: { kind: "timeline", sections: [] } });
    expect(shape("timeline\n  section Later\n")).toEqual([["Later", []]]);
  });

  it("drops a styling statement instead of reading it as a period", () => {
    // it used to become a period `classDef y fill` with an event `#f00`:
    // a bogus node on the canvas, and the user's text rewritten on save
    const result = parseTimeline("timeline\n  2002 : x\nclassDef y fill:#f00\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(shape("timeline\n  2002 : x\nclassDef y fill:#f00\n")).toEqual([["", [["2002", ["x"]]]]]);
    expect(result.warnings).toEqual([
      { line: 3, message: "`classDef` is not represented in the editor and will be lost on save" },
    ]);
  });

  it("keeps a period whose label merely starts with a dropped keyword", () => {
    expect(shape("timeline\n  style : guide\n")).toEqual([["", [["style", ["guide"]]]]]);
  });
});
