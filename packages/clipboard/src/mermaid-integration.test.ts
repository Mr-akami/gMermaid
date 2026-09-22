// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import mermaid from "mermaid";
import { copySelection } from "./clipboard";
import { FIXTURES } from "./fixtures";

// C4, the same argument as mermaid-codegen's own integration test: the point
// of carrying mermaid TEXT on the clipboard is that it pastes into any
// mermaid tool, so "valid on its own" has to be checked against the real
// mermaid.js parser, not only against ours. A slice is a sub-diagram we
// assembled, so this is where closure bugs surface as dialect errors.

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false });
});

describe.each(FIXTURES)("mermaid.js accepts what $name copies", (fixture) => {
  it.each(fixture.selections)("%s", async (_label, ids) => {
    const text = copySelection(fixture.ir, ids);
    expect(text).toBeDefined();
    await expect(mermaid.parse(text!), text).resolves.toBeTruthy();
  });
});
