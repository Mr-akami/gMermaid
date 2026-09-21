import { describe, expect, it } from "vitest";
import { dropList, firstStatement, prepareLines, type ParseWarning } from "./common";

const texts = (code: string, opts?: Parameters<typeof prepareLines>[1]) => prepareLines(code, opts).map((l) => l.text);

describe("prepareLines", () => {
  it("skips frontmatter, init directives, blank and comment lines; keeps original line numbers", () => {
    const code = `
---
title: Hello
config:
  theme: dark
---
%%{init: {'theme':'forest'}}%%
%%{
  init: { "flowchart": { "curve": "basis" } }
}%%
%% a comment
flowchart LR
  A --> B %% trailing comment
`;
    expect(prepareLines(code)).toEqual([
      { text: "flowchart LR", line: 12 },
      { text: "A --> B", line: 13 },
    ]);
  });

  it("does not treat `%%` inside quotes as a comment", () => {
    expect(texts('flowchart LR\n  A["100%% done"] --> B')).toEqual(["flowchart LR", 'A["100%% done"] --> B']);
  });

  it("strips a trailing `;` but keeps `#entity;` intact", () => {
    expect(texts("sequenceDiagram;\n  a->>b: x;\n  a->>b: #gt;")).toEqual(["sequenceDiagram", "a->>b: x", "a->>b: #gt;"]);
  });

  it("splits on `;` outside quotes/brackets when asked", () => {
    expect(texts('graph TD;\nA-->B; B-->C["x; y"];\nC-->|"#35;"| D', { splitSemicolons: true })).toEqual([
      "graph TD",
      "A-->B",
      'B-->C["x; y"]',
      'C-->|"#35;"| D',
    ]);
  });

  it("drops listed statements, including accDescr blocks, but not ids sharing a prefix", () => {
    const code = `flowchart LR
  style A fill:#f9f
  classDef cls fill:#f9f
  class A cls
  accTitle: t
  accDescr: one line
  accDescr {
    multi
    line
  }
  styleNode --> classy
`;
    expect(texts(code, { drop: ["style", "classDef", "class", "accTitle", "accDescr"] })).toEqual([
      "flowchart LR",
      "styleNode --> classy",
    ]);
  });

  it("collects a warning per dropped statement, at its original line", () => {
    const warnings: ParseWarning[] = [];
    prepareLines("flowchart LR\n  A --> B\n  classDef cls fill:#f9f\n  accTitle: t\n", {
      drop: dropList(),
      warnings,
    });
    expect(warnings).toEqual([
      { line: 3, message: "`classDef` is not represented in the editor and will be lost on save" },
      { line: 4, message: "`accTitle` is not represented in the editor and will be lost on save" },
    ]);
  });

  it("only drops a keyword whose argument has the shape of that statement", () => {
    const drop = dropList();
    // `class:` is a journey task, `style guide` a mindmap node, `click here`
    // an edge label — none of them styling
    expect(texts("journey\n  class: 5: Me\n", { drop })).toEqual(["journey", "class: 5: Me"]);
    expect(texts("mindmap\n  style guide\n", { drop })).toEqual(["mindmap", "style guide"]);
    expect(texts('flowchart LR\n  click here\n  click A "u"\n', { drop })).toEqual(["flowchart LR", "click here"]);
  });

  it("strips `:::className` suffixes outside quotes", () => {
    expect(texts('flowchart LR\n  A:::cls --> B["x:::notme"]:::other', { stripClassSuffix: true })).toEqual([
      "flowchart LR",
      'A --> B["x:::notme"]',
    ]);
  });
});

describe("firstStatement", () => {
  it("returns the header after preamble, or undefined for empty input", () => {
    expect(firstStatement("---\ntitle: x\n---\n%%{init: {}}%%\n\nstateDiagram-v2\n  a --> b")).toBe("stateDiagram-v2");
    expect(firstStatement("%% only a comment\n")).toBeUndefined();
  });
});

describe("class suffixes are reported, not silently stripped", () => {
  it("warns once per `:::` it removes and keeps the statement", () => {
    const warnings: ParseWarning[] = [];
    const lines = prepareLines("flowchart LR\n  A:::hot --> B:::cold\n", { stripClassSuffix: true, warnings });
    expect(lines.map((l) => l.text)).toEqual(["flowchart LR", "A --> B"]);
    expect(warnings.map((w) => w.line)).toEqual([2]);
    expect(warnings[0]?.message).toContain(":::");
  });

  it("leaves a quoted `:::` alone and stays silent", () => {
    const warnings: ParseWarning[] = [];
    const lines = prepareLines('flowchart LR\n  A["a:::b"] --> B\n', { stripClassSuffix: true, warnings });
    expect(lines[1]?.text).toBe('A["a:::b"] --> B');
    expect(warnings).toEqual([]);
  });
});
