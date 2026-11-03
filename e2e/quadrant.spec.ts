import { expect, test, type Locator, type Page } from "@playwright/test";
import { element, expectCode, openEditor, setCode } from "./helpers";

// A quadrant chart is the one diagram whose coordinates are DATA: dragging a
// point rewrites its `[x, y]`, not an auto layout's guess.

const CODE = `quadrantChart
  title Reach
  x-axis Low --> High
  y-axis Cold --> Hot
  quadrant-1 Expand
  "A": [0.3, 0.6]
  "B": [0.9, 0.1]
`;

/** Screen position of data coordinates (x, y), from the plot's own box. */
async function at(editor: Locator, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = (await editor.getByTestId("quadrant-plot").boundingBox())!;
  return { x: box.x + x * box.width, y: box.y + (1 - y) * box.height };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

test("dragging a point rewrites its coordinates, as one undo step", async ({ page }) => {
  const editor = await openEditor(page, "Quadrant");
  await setCode(editor, CODE);
  await expect(element(editor, "point-1")).toBeVisible();

  await drag(page, await at(editor, 0.3, 0.6), await at(editor, 0.8, 0.2));
  await expectCode(editor).toContain('"A": [0.8, 0.2]');
  // the other point did not move, and the dragged one is now selected
  await expectCode(editor).toContain('"B": [0.9, 0.1]');
  const props = editor.locator(".property-window");
  await expect(props.getByLabel("X (0 – 1)")).toHaveValue("0.8");
  await expect(props.getByLabel("Y (0 – 1)")).toHaveValue("0.2");

  await page.getByRole("button", { name: "Undo" }).click();
  await expectCode(editor).toContain('"A": [0.3, 0.6]');
  await page.getByRole("button", { name: "Redo" }).click();
  await expectCode(editor).toContain('"A": [0.8, 0.2]');

  // past the plot's edge the point stops AT the edge: data stays in 0..1
  const corner = await at(editor, 1, 1);
  await drag(page, await at(editor, 0.8, 0.2), { x: corner.x + 12, y: corner.y - 12 });
  await expectCode(editor).toContain('"A": [1, 1]');
});

test("the property window edits name and coordinates; the chart window edits axes and quadrants", async ({ page }) => {
  const editor = await openEditor(page, "Quadrant");
  await setCode(editor, CODE);
  const props = editor.locator(".property-window");

  // nothing selected: the chart's own fields
  await expect(props.getByRole("heading", { name: "Chart" })).toBeVisible();
  await props.getByLabel("X axis, high").fill("Very high");
  await props.getByLabel("Quadrant 3 (bottom-left)").fill("Drop");
  await expectCode(editor).toContain('x-axis "Low" --> "Very high"');
  await expectCode(editor).toContain('quadrant-3 "Drop"');
  await editor.getByLabel("Chart title").fill("Fresh");
  await expectCode(editor).toContain('title "Fresh"');

  // a point: name and data
  await element(editor, "point-2").click();
  await expect(props.getByRole("heading", { name: "Point" })).toBeVisible();
  await props.getByLabel("Name").fill("Bee");
  await props.getByLabel("X (0 – 1)").fill("0.25");
  await props.getByLabel("Y (0 – 1)").fill("2");
  await expectCode(editor).toContain('"Bee": [0.25, 1]');

  // + Point lands in the middle and is selected, ready to drag
  await editor.getByRole("button", { name: "+ Point" }).click();
  await expect(props.getByLabel("Name")).toHaveValue("Point 1");
  await expectCode(editor).toContain('"Point 1": [0.5, 0.5]');

  await editor.getByRole("toolbar", { name: "Selection actions" }).getByRole("button", { name: "Delete point" }).click();
  await expectCode(editor).not.toContain("Point 1");
});

test("a point cannot be nameless, and styling is dropped with a warning", async ({ page }) => {
  const editor = await openEditor(page, "Quadrant");
  await setCode(editor, 'quadrantChart\n  A:::hot: [0.3, 0.6] radius: 20, color: #ff0000\n  classDef hot color: #f00\n');

  const warnings = editor.locator(".code-warnings");
  await expect(warnings).toBeVisible();
  await expect(warnings).toContainText("`radius, color` is not represented in the editor and will be lost on save");
  await expect(warnings).toContainText("`classDef`");
  await expectCode(editor).toContain('"A": [0.3, 0.6]');
  await expectCode(editor).not.toContain("radius");

  await element(editor, "point-1").click();
  const name = editor.locator(".property-window").getByLabel("Name");
  await name.fill("");
  await expect(editor.getByText("a point needs a name")).toBeVisible();
  await expectCode(editor).toContain('"A"');
});
