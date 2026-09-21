import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ID_PREFIX, newId, repairedId } from "@gmermaid/ir";

// The `subgraph-<hex>` bug in one sentence: a generated id started with a
// mermaid keyword, so mermaid's lexer read the keyword and gave up. Keeping
// that from coming back needs the keywords themselves, not a hand-kept guess
// — so they are harvested from the grammars inside the installed mermaid.

const resolve = createRequire(import.meta.url).resolve;
const CHUNKS = join(dirname(resolve("mermaid/package.json")), "dist", "chunks", "mermaid.core");

/** Every word a mermaid grammar matches at the start of a token. The compiled
 * jison lexers spell their rules as `/^(?:keyword\b)/`, so the leading literal
 * of each rule is the keyword. Deliberately over-inclusive: a word harvested
 * by accident only costs us a prefix we do not pick. */
function mermaidKeywords(): Set<string> {
  const words = new Set<string>();
  for (const file of readdirSync(CHUNKS)) {
    if (!file.endsWith(".mjs")) continue;
    const source = readFileSync(join(CHUNKS, file), "utf8");
    for (const m of source.matchAll(/\/\^\(\?:([A-Za-z][A-Za-z0-9_-]*)/g)) words.add(m[1]!.toLowerCase());
  }
  // usecase-beta and the other langium grammars are not jison lexers, so
  // their keywords are not in the scan above.
  for (const w of ["usecase", "usecase-beta", "systemboundary", "direction", "end", "graph", "pie", "branch"]) words.add(w);
  return words;
}

describe("generated ids cannot spell a mermaid keyword", () => {
  const keywords = mermaidKeywords();

  it("harvests the keywords that caused the bug", () => {
    // a canary: if this scan ever stops finding anything, the assertions
    // below would pass vacuously
    for (const w of ["subgraph", "state", "class", "actor", "section", "note", "requirement", "element"]) {
      expect(keywords, `expected \`${w}\` among mermaid's keywords`).toContain(w);
    }
  });

  it("no id prefix is one", () => {
    for (const [kind, prefix] of Object.entries(ID_PREFIX)) {
      expect(keywords.has(prefix), `\`${prefix}\` (${kind}) is a mermaid keyword`).toBe(false);
    }
  });

  it("the branded kinds themselves mostly ARE keywords — which is why they are mapped", () => {
    const clashing = Object.keys(ID_PREFIX).filter((kind) => keywords.has(kind.toLowerCase()));
    expect(clashing).not.toHaveLength(0);
  });

  it("mints `<prefix>_<hex>`: no hyphen, so a state-diagram id is safe too", () => {
    expect(newId("subgraph")).toMatch(/^grp_[0-9a-f]{8}$/);
    expect(newId("state")).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
  });
});

describe("repairedId", () => {
  it("renames the old keyword-prefixed ids", () => {
    expect(repairedId("subgraph-a6bde494")).toBe("grp_a6bde494");
    expect(repairedId("state-a6bde494")).toBe("stt_a6bde494");
    expect(repairedId("class-a6bde494")).toBe("cls_a6bde494");
  });

  it("leaves everything else alone", () => {
    // not ours: a user id that merely starts with a keyword, and the ids
    // parsers mint per import (`note-1`) which never reach the text
    expect(repairedId("subgraphOfThings")).toBeUndefined();
    expect(repairedId("note-1")).toBeUndefined();
    expect(repairedId("nod_a6bde494")).toBeUndefined();
    expect(repairedId("state_a6bde494")).toBeUndefined();
  });

  it("is injective, so two old ids never land on the same new one", () => {
    const olds = Object.keys(ID_PREFIX).map((kind) => `${kind}-a6bde494`);
    const news = olds.map((id) => repairedId(id) ?? id);
    expect(new Set(news).size).toBe(news.length);
  });
});
