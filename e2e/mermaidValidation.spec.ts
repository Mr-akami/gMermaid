import { expect, test } from "@playwright/test";
import { openEditor, setCode } from "./helpers";

// CONTEXT.md's Validation rule: the code pane is judged by the REAL mermaid
// parser, not only by our hand-rolled one.
test("text our parser accepts but mermaid rejects is reported in the pane", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  // the user's bug: `subgraph` is a mermaid keyword, so `subgraph-1` cannot be
  // spelled as an edge endpoint — our parser reads it back happily, and the
  // codegen round-trips it, so nothing else in the app notices
  await setCode(editor, 'flowchart TB\n  a["A"]\n  subgraph subgraph-1["G"]\n  end\n  a --> subgraph-1\n');

  const rejection = editor.locator(".code-mermaid-error");
  await expect(rejection).toBeVisible({ timeout: 15_000 });
  await expect(rejection).toContainText("Mermaid.js");
  // it is not a gMermaid parse error: that pane stays empty
  await expect(editor.locator(".code-errors")).toHaveCount(0);

  // …and mermaid's opinion must not stop the work being saved: our own parser
  // accepted it, so it is in the IR and has to survive a reload
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("gmermaid:doc:flowchart") ?? ""))
    .toContain("subgraph-1"); // autosave debounce
  await page.reload();
  await page.getByRole("button", { name: "Flowchart", exact: true }).click();
  await expect(page.locator(".editor:not(.hidden) .cm-content")).toContainText("subgraph-1");
});

