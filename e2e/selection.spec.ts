import { expect, test, type Locator, type Page } from "@playwright/test";
import { codeText, element, expectCode, openEditor, setCode } from "./helpers";

// Range selection, the context menu and the clipboard, checked where they
// can be driven for real: a rubber band is a pointer gesture, a long press
// is a clock, and the clipboard is a browser permission — none of the three
// can be proved in a unit test.

// the clipboard is permission-gated; the app falls back to its own memory
// when the browser refuses, but the point of the feature is the real one
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const TWO_NODES = 'flowchart TB\n  A["Start"] --> B["End"]\n';

/** Drag a rubber band across the canvas, in canvas-relative pixels. */
async function band(
  page: Page,
  editor: Locator,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const canvas = (await editor.locator(".canvas").boundingBox())!;
  await page.mouse.move(canvas.x + from.x, canvas.y + from.y);
  await page.mouse.down();
  await page.mouse.move(canvas.x + to.x, canvas.y + to.y, { steps: 10 });
  await page.mouse.up();
}

/** Press and hold on an element until the long press fires. */
async function longPress(page: Page, editor: Locator, id: string): Promise<void> {
  const box = (await element(editor, id).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
}

async function setClipboard(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
}

/** How many times `needle` occurs in the code pane. */
function countInCode(editor: Locator, needle: string) {
  return expect.poll(async () => (await codeText(editor)).split(needle).length - 1, { timeout: 5_000 });
}

test("a rubber band selects several elements and Delete removes them all", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, 'flowchart TB\n  A["Start"] --> B["Middle"]\n  B --> C["End"]\n');
  await expect(editor.locator("svg [data-element-id]")).toHaveCount(5); // 3 nodes, 2 edges

  // the toolbar toggle is the discoverable half of the gesture
  await editor.getByRole("button", { name: "▭ Select" }).click();
  const canvas = (await editor.locator(".canvas").boundingBox())!;
  await band(page, editor, { x: 3, y: 3 }, { x: canvas.width - 3, y: canvas.height - 3 });

  await expect(editor.getByRole("heading", { name: /個の要素を選択中$/ })).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(editor.locator("svg [data-element-id]")).toHaveCount(0);
});

test("Shift+drag draws the band without the toggle, and panning keeps the plain drag", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, TWO_NODES);
  const canvas = (await editor.locator(".canvas").boundingBox())!;

  await page.keyboard.down("Shift");
  await band(page, editor, { x: 3, y: 3 }, { x: canvas.width - 3, y: canvas.height - 3 });
  await page.keyboard.up("Shift");
  await expect(editor.getByRole("heading", { name: /個の要素を選択中$/ })).toBeVisible();

  // the same drag without Shift is still a pan: it selects nothing
  await page.keyboard.press("Escape");
  await band(page, editor, { x: 3, y: 3 }, { x: canvas.width - 3, y: canvas.height - 3 });
  await expect(editor.getByRole("heading", { name: /個の要素を選択中$/ })).toBeHidden();
});

test("Ctrl+click adds to the selection, a plain click drops back to one", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, TWO_NODES);

  await element(editor, "A").click();
  await expect(editor.getByRole("heading", { name: "Node" })).toBeVisible();
  await element(editor, "B").click({ modifiers: ["ControlOrMeta"] });
  await expect(editor.getByRole("heading", { name: "2 個の要素を選択中" })).toBeVisible();

  await element(editor, "A").click();
  await expect(editor.getByRole("heading", { name: "Node" })).toBeVisible();
});

test("Ctrl+C then Ctrl+V duplicates the selection without colliding ids", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, TWO_NODES);

  await element(editor, "A").click();
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+v");

  // the copy is a SECOND node with the same label, not the same node twice
  await countInCode(editor, '"Start"').toBe(2);
  await expect(editor.locator("svg [data-element-id]")).toHaveCount(4);
  // and what arrived is what is selected, ready to be moved or deleted
  await expect(editor.getByRole("heading", { name: "Node" })).toBeVisible();
  await page.keyboard.press("Delete");
  await countInCode(editor, '"Start"').toBe(1);
});

test("what is copied is mermaid text, so it pastes into the code pane too", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, TWO_NODES);

  await element(editor, "A").click();
  await page.keyboard.press("ControlOrMeta+c");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("flowchart");
  expect(copied).toContain('"Start"');
});

test("Ctrl+X removes the selection and Ctrl+V puts it back", async ({ page }) => {
  const editor = await openEditor(page, "State");
  await setCode(editor, "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy : go\n");
  await expect(element(editor, "Busy")).toHaveCount(1);

  await element(editor, "Busy").click();
  await page.keyboard.press("ControlOrMeta+x");
  await expectCode(editor).not.toContain("Busy");

  await page.keyboard.press("ControlOrMeta+v");
  await expectCode(editor).toContain("Busy");
});

test("right click and a long press both open the menu; Escape closes it", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, TWO_NODES);

  await element(editor, "A").click({ button: "right" });
  const menu = editor.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "コピー" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  // Escape closed the menu only — the element it was about is still selected
  await expect(editor.getByRole("heading", { name: "Node" })).toBeVisible();

  await longPress(page, editor, "B");
  await expect(editor.getByRole("menu")).toBeVisible();

  // an outside click closes it as well
  await editor.locator(".canvas").click({ position: { x: 4, y: 4 } });
  await expect(editor.getByRole("menu")).toBeHidden();
});

test("the menu's Delete removes the element it was opened on", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, TWO_NODES);

  await element(editor, "B").click({ button: "right" });
  await editor.getByRole("menuitem", { name: "削除" }).click();
  await expectCode(editor).not.toContain('"End"');
  await expect(element(editor, "B")).toHaveCount(0);
});

test("the menu offers Move only where the diagram kind has one", async ({ page }) => {
  // a state's move is real: it re-parents into a composite
  const state = await openEditor(page, "State");
  await setCode(state, "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy : go\n");
  await element(state, "Busy").click({ button: "right" });
  await expect(state.getByRole("menuitem", { name: /^移動…/ })).toBeVisible();
  await state.getByRole("menuitem", { name: /^移動…/ }).click();
  await expect(state.getByText("click the container state", { exact: false })).toBeVisible();

  // a mindmap's move is sibling order
  const mindmap = await openEditor(page, "Mindmap");
  await setCode(mindmap, "mindmap\n  root[Root]\n    a[Alpha]\n    b[Beta]\n");
  await element(mindmap, "b").click({ button: "right" });
  await expect(mindmap.getByRole("menuitem", { name: "↑ 上へ移動" })).toBeVisible();
  await mindmap.getByRole("menuitem", { name: "↑ 上へ移動" }).click();
  await expectCode(mindmap).toMatch(/Beta[\s\S]*Alpha/);

  // a flowchart node has no reparent action, so it shows no dead entry
  const flowchart = await openEditor(page, "Flowchart");
  await setCode(flowchart, TWO_NODES);
  await element(flowchart, "A").click({ button: "right" });
  await expect(flowchart.getByRole("menu")).toBeVisible();
  await expect(flowchart.getByRole("menuitem", { name: /移動/ })).toHaveCount(0);
});

test("a mindmap subtree copies and pastes as an outline", async ({ page }) => {
  const editor = await openEditor(page, "Mindmap");
  await setCode(editor, "mindmap\n  root[Root]\n    a[Alpha]\n      a1[Leaf]\n");

  await element(editor, "a").click();
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+v");

  await countInCode(editor, "Alpha").toBe(2);
  await countInCode(editor, "Leaf").toBe(2);
});

test("text from another diagram kind is refused, with the reason", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, TWO_NODES);
  await setClipboard(page, "sequenceDiagram\n  Alice->>Bob: hi\n");

  await editor.locator(".canvas").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("ControlOrMeta+v");
  await expect(editor.getByText("cannot paste a sequence diagram", { exact: false })).toBeVisible();
  await expect(editor.locator("svg [data-element-id]")).toHaveCount(3);
});

test("text that is no diagram at all is refused too", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, TWO_NODES);
  await setClipboard(page, "just some notes I had in my clipboard");

  await editor.locator(".canvas").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("ControlOrMeta+v");
  await expect(editor.getByText("does not hold a mermaid diagram", { exact: false })).toBeVisible();
});

test("copy and paste inside a property field stay the user's own", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, TWO_NODES);
  await setClipboard(page, "Renamed");

  await element(editor, "A").click();
  const label = editor.getByLabel("Label", { exact: true });
  await label.click();
  await label.press("ControlOrMeta+a");
  await label.press("ControlOrMeta+v");

  // the field took the text; the canvas gained nothing
  await expectCode(editor).toContain('"Renamed"');
  await expect(editor.locator("svg [data-element-id]")).toHaveCount(3);
});

test("copy and paste inside the code pane stay the user's own", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, TWO_NODES);
  await setClipboard(page, '  C["Third"]\n');

  const code = editor.locator(".cm-content");
  await code.click();
  await page.keyboard.press("ControlOrMeta+v");
  // the pane took it as TEXT — one new node, written by the user's own
  // paste. Had the shell taken the key as well it would have refused the
  // fragment out loud, and a second paste would have doubled the diagram.
  await expect(editor.locator("svg [data-element-id]")).toHaveCount(4);
  await countInCode(editor, '"Third"').toBe(1);
  await expect(editor.getByText("読めない", { exact: false })).toHaveCount(0);
});

// The app shipped against a three-kind stand-in while the clipboard model was
// built separately; these are the kinds that used to be refused by name.
const COPYABLE: ReadonlyArray<readonly [Parameters<typeof openEditor>[1], string, string, string]> = [
  ["Class", "classDiagram\n  class Alpha\n  class Beta\n  Alpha --> Beta\n", "Alpha", "Alpha"],
  ["Sequence", "sequenceDiagram\n  participant Ann\n  participant Bob\n  Ann->>Bob: hello\n", "hello", "hello"],
  ["Timeline", "timeline\n  section Early\n    2002 : LinkedIn\n    2004 : Facebook\n", "LinkedIn", "LinkedIn"],
];

for (const [kind, source, clickLabel, needle] of COPYABLE) {
  test(`${kind} copies and pastes through the real clipboard`, async ({ page }) => {
    const editor = await openEditor(page, kind);
    await setCode(editor, source);
    await expectCode(editor).toContain(needle);

    // the label is a <tspan> with pointer events off; the group carrying the
    // element id is what the canvas listens on
    await editor.locator("svg [data-element-id]").filter({ hasText: clickLabel }).first().click();
    await page.keyboard.press("ControlOrMeta+c");
    await page.keyboard.press("ControlOrMeta+v");

    // the copy lands with a fresh identity, so the name appears twice
    await countInCode(editor, needle).toBeGreaterThan(1);
  });
}
