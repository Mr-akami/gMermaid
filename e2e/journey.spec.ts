import { expect, test } from "@playwright/test";
import { codeText, element, openEditor, setCode } from "./helpers";

// The sample from https://mermaid.js.org/syntax/userJourney.html
const DOCS_SAMPLE = `journey
    title My working day
    section Go to work
      Make tea: 5: Me
      Go upstairs: 3: Me
      Do work: 1: Me, Cat
    section Go home
      Go downstairs: 5: Me
      Sit down: 5: Me
`;

test("pasted journey code renders every task and section on the canvas", async ({ page }) => {
  const editor = await openEditor(page, "Journey");
  await setCode(editor, DOCS_SAMPLE);
  // 5 tasks + 2 sections, each carrying a data-element-id
  await expect(editor.locator("svg [data-element-id]")).toHaveCount(7);
  await expect(editor.locator("svg text", { hasText: "My working day" }).first()).toBeVisible();
  await expect(editor.locator("svg text", { hasText: "Make tea" }).first()).toBeVisible();
  // actors become a legend, one entry per distinct actor
  await expect(editor.locator("svg text", { hasText: "Cat" }).first()).toBeVisible();
});

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

  const code = await codeText(editor);
  expect(code).toContain("Share it: 4: User, Support");
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
  expect(await codeText(editor)).toContain("section Evening");

  // reorder: the new section moves ahead of "First use"
  await editor.getByRole("button", { name: "Move earlier" }).click();
  const code = await codeText(editor);
  expect(code.indexOf("section Evening")).toBeLessThan(code.indexOf("section First use"));

  await editor.getByRole("button", { name: "Undo" }).click();
  expect(await codeText(editor)).toMatch(/section First use[\s\S]*section Evening/);

  await editor.getByRole("button", { name: "Delete", exact: true }).click();
  expect(await codeText(editor)).not.toContain("section Evening");
});
