import { expect, test, type Locator } from "@playwright/test";
import { element, expectCode, expectInsideCanvas, openEditor, openStoredEditor, panAway, setCode, type Kind } from "./helpers";

// The behaviour every editor owes the user, checked where it can be driven
// for real: the keys that act on the selection, and the camera.

const KINDS: readonly Kind[] = [
  "Flowchart",
  "Sequence",
  "Class",
  "State",
  "Timeline",
  "Journey",
  "Requirement",
  "Usecase",
  "Mindmap",
  "Gantt",
];

/** Ids of elements the canvas is currently cutting off. */
async function clipped(editor: Locator): Promise<string[]> {
  return editor.evaluate((root) => {
    const canvas = root.querySelector(".canvas")!.getBoundingClientRect();
    const out: string[] = [];
    for (const el of root.querySelectorAll("svg [data-element-id]")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // a zero-length edge has no box
      if (r.left < canvas.left - 1 || r.top < canvas.top - 1 || r.right > canvas.right + 1 || r.bottom > canvas.bottom + 1) {
        out.push(el.getAttribute("data-element-id") ?? "?");
      }
    }
    return out;
  });
}

test("every editor offers the same undo/redo, delete and fit controls", async ({ page }) => {
  for (const kind of KINDS) {
    const editor = await openEditor(page, kind);
    await expect(editor.getByRole("button", { name: "Undo", exact: true }), kind).toBeVisible();
    await expect(editor.getByRole("button", { name: "Redo", exact: true }), kind).toBeVisible();
    await expect(editor.getByLabel("Fit view"), kind).toBeVisible();
    await expect(editor.getByRole("button", { name: /^Delete/ }), kind).toBeVisible();
  }
});

test("no sample diagram opens clipped by the canvas", async ({ page }) => {
  for (const kind of KINDS) {
    const editor = await openEditor(page, kind);
    expect(await clipped(editor), `${kind} sample`).toEqual([]);
  }
});

test("Delete removes the selected node, Escape drops the selection", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, 'flowchart TB\n  A["Start"] --> B["End"]\n');

  await element(editor, "A").click();
  await expect(editor.getByRole("heading", { name: "Node" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor.getByRole("heading", { name: "Node" })).toBeHidden();

  await element(editor, "B").click();
  await page.keyboard.press("Delete");
  await expectCode(editor).not.toContain('B["End"]');
  await expect(element(editor, "B")).toHaveCount(0);
});

test("Backspace removes the selected class", async ({ page }) => {
  const editor = await openEditor(page, "Class");
  await setCode(editor, "classDiagram\n  class Animal\n  class Dog\n  Animal <|-- Dog\n");

  await element(editor, "Dog").click();
  await page.keyboard.press("Backspace");
  await expectCode(editor).not.toContain("Dog");
  await expectCode(editor).toContain("Animal");
});

test("a Delete the editor refuses says why, as the button would", async ({ page }) => {
  const editor = await openEditor(page, "Sequence");
  await setCode(editor, "sequenceDiagram\n  Alice->>Bob: hi\n  alt yes\n    Alice->>Bob: a\n  else no\n    Alice->>Bob: b\n  end\n");

  // an else arm is reached by its condition label
  await element(editor, "branch-2").locator("text").click();
  await expect(editor.getByRole("heading", { name: /^Branch/ })).toBeVisible();

  await page.keyboard.press("Delete");
  await expect(editor.getByText("a branch cannot be deleted on its own", { exact: false })).toBeVisible();
  await expectCode(editor).toContain("else no");
});

test("a key typed in a property field never deletes the element", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, 'flowchart TB\n  A["Start"] --> B["End"]\n');

  await element(editor, "A").click();
  const label = editor.getByLabel("Label", { exact: true });
  await label.click();
  await label.press("Backspace");
  await label.press("Delete");
  await expect(element(editor, "A")).toHaveCount(1);
  await expectCode(editor).toContain('A["Star"]');

  // …nor one typed in the code pane
  const code = editor.locator(".cm-content");
  await code.click();
  await page.keyboard.press("Delete");
  await expect(element(editor, "A")).toHaveCount(1);
});

test("Ctrl+Z and Ctrl+Shift+Z undo and redo", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, 'flowchart TB\n  A["Start"] --> B["End"]\n');

  await editor.getByRole("button", { name: "+ Node" }).click();
  await expectCode(editor).toContain('["Node"]');

  await page.keyboard.press("ControlOrMeta+z");
  await expectCode(editor).not.toContain('["Node"]');
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expectCode(editor).toContain('["Node"]');
});

// A flowchart far wider than the canvas: at scale 1 its tail is off screen.
const WIDE = `flowchart LR\n${Array.from({ length: 16 }, (_, i) => `  N${i}["Node ${i}"] --> N${i + 1}["Node ${i + 1}"]`).join("\n")}\n`;

test("a diagram wider than the canvas is framed when it is loaded", async ({ page }) => {
  const editor = await openStoredEditor(page, "Flowchart", WIDE);
  await expect(element(editor, "N16")).toBeVisible();
  await expectInsideCanvas(editor, "N0");
  await expectInsideCanvas(editor, "N16");
  expect(await clipped(editor)).toEqual([]);
});

test("Fit brings a diagram panned off screen back", async ({ page }) => {
  const editor = await openEditor(page, "Mindmap");
  await panAway(page, editor);
  expect(await clipped(editor)).not.toEqual([]);

  await editor.getByLabel("Fit view").click();
  expect(await clipped(editor)).toEqual([]);
});
