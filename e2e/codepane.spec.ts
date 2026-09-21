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
