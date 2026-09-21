import { expect, type Locator, type Page } from "@playwright/test";

export type Kind = "Flowchart" | "Sequence" | "Class" | "State" | "Requirement" | "Journey" | "Timeline" | "Gantt" | "Mindmap";

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

/** Assert on the code pane after a GUI edit. The pane defers external value
 * updates for ~200ms after a local edit, so a single `codeText` read right
 * after a click or keystroke races that sync — poll instead. */
export function expectCode(editor: Locator) {
  return expect.poll(() => codeText(editor), { timeout: 5_000 });
}

/** Click the middle of an edge/relation path.
 *
 * A polyline's <g> bounding box centre is usually empty canvas, so a plain
 * `.click()` on the element either misses the stroke or is blocked by a
 * neighbouring path; walk the geometry instead. */
export async function clickPathMiddle(page: Page, editor: Locator, id: string): Promise<void> {
  const point = await element(editor, id)
    .locator("path")
    .first()
    .evaluate((el) => {
      const path = el as unknown as SVGPathElement;
      const p = path.getPointAtLength(path.getTotalLength() / 2);
      const m = path.getScreenCTM()!;
      return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
    });
  await page.mouse.click(point.x, point.y);
}

export function element(editor: Locator, id: string): Locator {
  return editor.locator(`[data-element-id="${id}"]`);
}
