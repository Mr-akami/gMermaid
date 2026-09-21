import { expect, test } from "@playwright/test";
import { element, expectCode, openEditor, setCode } from "./helpers";

// The sample from https://mermaid.js.org/syntax/mindmap.html
const DOCS_SAMPLE = `mindmap
  root((mindmap))
    Origins
      Long history
      ::icon(fa fa-book)
      Popularisation
        British popular psychology author Tony Buzan
    Research
      On effectiveness<br/>and features
      On Automatic creation
        Uses
            Creative techniques
            Strategic planning
            Argument mapping
    Tools
      Pen and paper
      Mermaid
`;

test("pasted mindmap code renders every node of the outline", async ({ page }) => {
  const editor = await openEditor(page, "Mindmap");
  await setCode(editor, DOCS_SAMPLE);
  // 15 nodes; the `::icon(…)` line decorates one of them instead of adding one
  await expect(editor.locator("svg [data-element-id]")).toHaveCount(15);
  await expect(editor.locator("svg text", { hasText: "Popularisation" }).first()).toBeVisible();
  await expect(editor.locator("svg text", { hasText: "Argument mapping" }).first()).toBeVisible();
  // `<br/>` became a real line break, so the label is split over two tspans
  await expect(editor.locator("svg text", { hasText: "and features" }).first()).toBeVisible();
  // the icon travelled with its node
  await expect(editor.locator("svg text", { hasText: "fa fa-book" }).first()).toBeVisible();
});

test("adding a child through the GUI and reshaping it writes the bracket form back", async ({ page }) => {
  const editor = await openEditor(page, "Mindmap");
  await setCode(editor, "mindmap\n  root((mindmap))\n    Origins\n");

  await element(editor, "root").click();
  await expect(editor.getByRole("heading", { name: "Node" })).toBeVisible();
  await editor.getByRole("button", { name: "+ Child" }).click();

  const label = editor.getByLabel("Label");
  await expect(label).toHaveValue("Idea 1");
  await label.fill("Research");
  await label.blur();
  // the default shape is bare text under its parent
  await expectCode(editor).toMatch(/root\(\("mindmap"\)\)[\s\S]*Research/);

  await editor.getByLabel("Shape").selectOption("square");
  await expectCode(editor).toMatch(/\["Research"\]/);

  await editor.getByLabel("Shape").selectOption("hexagon");
  await expectCode(editor).toMatch(/\{\{"Research"\}\}/);

  // an icon is emitted as its own `::icon(…)` line
  await editor.getByLabel("Icon").fill("fa fa-book");
  await editor.getByLabel("Icon").blur();
  await expectCode(editor).toContain("::icon(fa fa-book)");

  await editor.getByRole("button", { name: "Undo" }).click();
  await expectCode(editor).not.toContain("::icon(fa fa-book)");
});

test("siblings reorder and a deleted node takes its subtree with it", async ({ page }) => {
  const editor = await openEditor(page, "Mindmap");
  await setCode(editor, "mindmap\n  root((root))\n    a[A]\n      a1[A1]\n    b[B]\n");

  await element(editor, "b").click();
  await editor.getByRole("button", { name: "↑ Move up" }).click();
  await expectCode(editor).toMatch(/\["B"\][\s\S]*\["A"\]/);

  await element(editor, "a").click();
  await editor.getByRole("button", { name: "Delete subtree" }).click();
  await expectCode(editor).not.toContain('["A1"]');
  await expectCode(editor).not.toContain('["A"]');
  await expectCode(editor).toContain('["B"]');
});

test("dragging a node onto another one re-parents its whole subtree", async ({ page }) => {
  const editor = await openEditor(page, "Mindmap");
  await setCode(editor, "mindmap\n  root((root))\n    a[A]\n      a1[A1]\n    b[B]\n");

  const from = (await element(editor, "a").locator("rect").last().boundingBox())!;
  const to = (await element(editor, "b").locator("rect").last().boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();

  // A (with A1 under it) is now indented below B
  await expectCode(editor).toMatch(/ {4}b\["B"\]\n {6}a\["A"\]\n {8}a1\["A1"\]/);
});

test("typing a new outline into the code pane redraws the canvas", async ({ page }) => {
  const editor = await openEditor(page, "Mindmap");
  await setCode(editor, "mindmap\n  Root\n    First\n    Second\n");
  await expect(editor.locator("svg [data-element-id]")).toHaveCount(3);
  await expect(editor.locator("svg text", { hasText: "Second" }).first()).toBeVisible();
});

test("a label the outline cannot carry is refused with a reason", async ({ page }) => {
  const editor = await openEditor(page, "Mindmap");
  await setCode(editor, 'mindmap\n  root((mindmap))\n    Origins\n      Long history\n');

  await element(editor, "mindmap-1").click();
  const label = editor.getByLabel("Label");
  await expect(label).toHaveValue("Origins");

  // an empty label would leave nothing but indentation on the line: the node
  // would vanish on re-import and "Long history" would climb to the root
  await label.fill("");
  await expect(editor.getByText("a node needs a label")).toBeVisible();
  await expectCode(editor).toContain("Origins");

  // a leading space would be read as deeper indentation, `:::` as a class
  await label.fill("  Roots:::x");
  await expectCode(editor).toContain("Rootsx");
});
