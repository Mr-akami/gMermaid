import { expect, test } from "@playwright/test";
import { element, expectCode, openEditor, setCode } from "./helpers";

// Styling has no IR (ADR 0001), so it is dropped on import — but silently
// dropping it is how a user loses their `classDef` without ever being told.

test("a dropped styling statement is reported and the diagram still renders", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, 'flowchart TB\n  a[One] --> b[Two]\n  classDef hot fill:#f00\n  style a fill:#0f0\n  click a "https://example.com"\n');

  const warnings = editor.locator(".code-warnings");
  await expect(warnings).toBeVisible();
  await expect(warnings).toContainText("line 3: `classDef` is not represented in the editor and will be lost on save");
  await expect(warnings).toContainText("`style`");
  await expect(warnings).toContainText("`click`");

  // informational only: the diagram committed, so it renders and the code
  // pane holds the canonical (styling-free) text — no error block
  await expect(editor.locator(".code-errors")).toHaveCount(0);
  await expect(element(editor, "a")).toBeVisible();
  await expect(element(editor, "b")).toBeVisible();
  await expectCode(editor).toContain("a[One] --> b[Two]");
  await expectCode(editor).not.toContain("classDef");
});

test("editing again clears the warning", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, "flowchart TB\n  a[One] --> b[Two]\n  classDef hot fill:#f00\n");
  await expect(editor.locator(".code-warnings")).toBeVisible();

  await setCode(editor, "flowchart TB\n  a[One] --> b[Two]\n");
  await expect(editor.locator(".code-warnings")).toHaveCount(0);
});
