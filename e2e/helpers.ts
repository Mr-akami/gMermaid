import { expect, type Locator, type Page } from "@playwright/test";

export type Kind = "Flowchart" | "Sequence" | "Class" | "State" | "Requirement" | "Journey";

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

/** The mermaid text currently shown in the code pane of the visible editor.
 *
 * Reads once. After anything is typed into the pane, the CodeMirror wrapper
 * holds back external value updates while it believes the user is still
 * typing (a 200ms latch), so the pane trails the IR for a moment. Assert
 * with `expectCode` instead of comparing a single read. */
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
  // dispatching on the view avoids CodeMirror auto-indent mangling pasted
  // lines; the content DOM carries the view as `cmTile` (older CodeMirror
  // called it `cmView`), so accept either handle
  await cm.evaluate((el, t) => {
    type Handle = { view: { dispatch: (tr: unknown) => void; state: { doc: { length: number } } } };
    const host = el as unknown as { cmTile?: Handle; cmView?: Handle };
    const view = (host.cmTile ?? host.cmView)?.view;
    if (!view) throw new Error("CodeMirror view not found");
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } });
  }, text);
  await cm.blur();
}

/** Poll the code pane until it settles, then assert on its text. Use this
 * for anything read after an edit — see the latch note on `codeText`. */
export function expectCode(editor: Locator) {
  return expect.poll(() => codeText(editor), { timeout: 5_000 });
}

export function element(editor: Locator, id: string): Locator {
  return editor.locator(`[data-element-id="${id}"]`);
}
