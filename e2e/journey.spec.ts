import { expect, test } from "@playwright/test";
import { codeText, element, expectCode, openEditor } from "./helpers";


test("adding a task through the GUI and scoring it writes it back into the code", async ({ page }) => {
  const editor = await openEditor(page, "Journey");
  const before = await codeText(editor);
  expect(before).toMatch(/^journey/);

  // select a section on the canvas, then add a task into it (labels are
  // click-through, so the band itself is the hit target)
  await element(editor, "section-3").click();
  await expect(editor.getByRole("heading", { name: "Section" })).toBeVisible();
  await editor.getByRole("button", { name: "+ Task" }).click();

  const nameField = editor.getByLabel("Task name");
  await expect(nameField).toHaveValue("Task 1");
  await nameField.fill("Share it");
  await nameField.blur();
  await editor.getByLabel("Task actors").fill("User, Support");
  await editor.getByLabel("Task actors").blur();
  await editor.getByLabel("Task score").selectOption("4");

  await expectCode(editor).toContain("Share it: 4: User, Support");
  const code = await codeText(editor);
  // it landed in the section it was added to, after that section's own tasks
  expect(code.indexOf("Share it")).toBeGreaterThan(code.indexOf("Create a diagram"));
  // one more task box on the canvas than before
  await expect(editor.locator("svg [data-element-id]")).toHaveCount(9);
});

test("the toolbar adds a section and the property window renames and reorders it", async ({ page }) => {
  const editor = await openEditor(page, "Journey");
  await editor.getByRole("button", { name: "+ Section" }).click();
  const nameField = editor.getByLabel("Section name");
  await expect(nameField).toHaveValue("Section 4");
  await nameField.fill("Evening");
  await nameField.blur();
  await expectCode(editor).toContain("section Evening");

  // reorder: the new section moves ahead of "First use"
  await editor.getByRole("button", { name: "Move earlier" }).click();
  await expectCode(editor).toMatch(/section Evening[\s\S]*section First use/);

  await page.getByRole("button", { name: "Undo" }).click();
  await expectCode(editor).toMatch(/section First use[\s\S]*section Evening/);

  await editor.getByRole("button", { name: "Delete", exact: true }).click();
  await expectCode(editor).not.toContain("section Evening");
});
