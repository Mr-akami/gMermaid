import { expect, type Locator, type Page } from "@playwright/test";

export type Kind = "Flowchart" | "Sequence" | "Class" | "State";

/** Open the app fresh (no autosave) and switch to a diagram tab. */
export async function openEditor(page: Page, kind: Kind): Promise<Locator> {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: kind, exact: true }).click();
  const editor = page.locator(".editor:not(.hidden)");
  await expect(editor).toBeVisible();
  return editor;
}

/** The mermaid text currently shown in the code pane of the visible editor. */
export async function codeText(editor: Locator): Promise<string> {
  const cm = editor.locator(".cm-content");
  await expect(cm).toBeVisible();
  // CodeMirror renders one .cm-line per line; innerText keeps the breaks
  return (await cm.innerText()).replace(/ /g, " ").trimEnd();
}

/** Replace the code pane text and blur so the draft is applied to the IR. */
export async function setCode(editor: Locator, text: string): Promise<void> {
  const cm = editor.locator(".cm-content");
  await cm.click();
  await cm.press("ControlOrMeta+a");
  await cm.press("Delete");
  // insertText avoids CodeMirror auto-indent interfering with pasted lines
  await cm.evaluate((el, t) => {
    const view = (el as unknown as { cmView?: { view: { dispatch: (tr: unknown) => void; state: { doc: { length: number } } } } }).cmView?.view;
    if (!view) throw new Error("CodeMirror view not found");
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } });
  }, text);
  await cm.blur();
}

export function element(editor: Locator, id: string): Locator {
  return editor.locator(`[data-element-id="${id}"]`);
}
