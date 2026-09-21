import { describe, expect, it } from "vitest";
import { firstStatement, prepareLines } from "./common";

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
