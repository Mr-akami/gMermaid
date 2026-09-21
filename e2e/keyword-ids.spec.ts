import { expect, test } from "@playwright/test";
import { codeText, element, expectCode, openEditor, setCode } from "./helpers";

// The bug this guards: every id the GUI mints lands in the mermaid text, and
// `subgraph-<hex>` made mermaid's lexer stop at the keyword. mermaid.js is
// not importable from a playwright spec (it needs a DOM and lives in the
// codegen package), so the real mermaid.parse check runs in
// packages/mermaid-codegen/src/editor-shaped.test.ts and this spec pins the
// shape of what the GUI actually writes.
const GENERATED_ID = /^[a-z]{3}_[0-9a-f]{8}$/;

test("a flowchart built through the toolbar, subgraph and all, spells ids mermaid can read", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");

  await editor.getByRole("button", { name: "+ Node" }).click();
  await editor.getByRole("button", { name: "+ Subgraph" }).click();
  // the new subgraph is selected, so the next node is born inside it
  await editor.getByRole("button", { name: "+ Node" }).click();

  const code = await codeText(editor);
  const group = code.match(/^\s*subgraph (\S+)\["Group 1"\]$/m)?.[1];
  expect(group, code).toBeDefined();
  expect(group).toMatch(GENERATED_ID);

  // drag one node onto the subgraph frame: an edge whose ENDPOINT is the
  // subgraph is what the user hit
  const node = code.match(/^\s*(\S+)\["Node"\]$/m)?.[1];
  expect(node, code).toBeDefined();
  const from = (await element(editor, node!).locator("rect").first().boundingBox())!;
  const to = (await element(editor, group!).locator("rect").first().boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // aim just inside the frame's top edge, clear of the node it contains
  await page.mouse.move(to.x + to.width / 2, to.y + 6, { steps: 12 });
  await page.mouse.up();

  await expectCode(editor).toContain(`--> ${group}`);

  // nothing in the finished text starts a statement with a mermaid keyword
  const finished = await codeText(editor);
  for (const id of finished.matchAll(/\b[a-z]+_[0-9a-f]{8}\b/g)) expect(id[0]).toMatch(GENERATED_ID);
  expect(finished).not.toMatch(/\b(?:subgraph|class|state|note|actor|section|box|element|requirement|namespace)-[0-9a-f]{8}\b/);
});

test("a diagram saved with the old ids is repaired when it is opened", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(
    editor,
    `flowchart TB
  node-e455cb6b("Start")
  subgraph subgraph-a6bde494["Group 1"]
    node-1b2c3d4e["Inside"]
  end
  node-e455cb6b --> subgraph-a6bde494
`,
  );

  // the keyword-prefixed id is gone from the text, references and all
  await expectCode(editor).toContain('subgraph grp_a6bde494["Group 1"]');
  await expectCode(editor).toContain("--> grp_a6bde494");
  await expectCode(editor).not.toContain("subgraph-a6bde494");
  await expect(element(editor, "grp_a6bde494")).toBeVisible();
});
