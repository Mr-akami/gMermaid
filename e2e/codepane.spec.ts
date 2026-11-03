import { expect, test } from "@playwright/test";
import { expectCode, openEditor, setCode } from "./helpers";

// The pane and the canvas are two views of one IR (ADR 0001). A code edit
// must not pin the pane to its own draft: later GUI edits have to show up
// in the text too.
test("the code pane keeps mirroring the diagram after a code edit", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, "flowchart TB\n  a[One] --> b[Two]\n");
  // a committed edit is not a conflict, so no "diagram changed" banner
  await expect(editor.locator(".code-banner")).toHaveCount(0);
  await expectCode(editor).toContain("a --> b");

  await editor.getByRole("button", { name: "+ Node" }).click();
  await expectCode(editor).toContain("Node");
});

// An error entry is a jump target: it selects its line, scrolls it into view
// and gives the pane the focus back.
test("clicking a parse error selects its line in the code pane", async ({ page }) => {
  const editor = await openEditor(page, "Sequence");
  const filler = Array.from({ length: 60 }, (_, i) => `  A->>B: m${i}`).join("\n");
  await setCode(editor, `sequenceDiagram\n${filler}\n  this is not a statement\n`);
  const entry = editor.locator(".code-error-entry").first();
  await expect(entry).toContainText("line 62");
  await entry.click();
  await expect(editor.locator(".cm-content:visible")).toBeFocused();
  const sel = await page.evaluate(() => window.getSelection()?.toString());
  expect(sel).toContain("this is not a statement");
  await expect(editor.locator(".cm-line", { hasText: "this is not a statement" })).toBeInViewport();
});
