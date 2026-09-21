import { expect, test } from "@playwright/test";
import { codeText, element, expectCode, openEditor, setCode } from "./helpers";

// The sectioned sample from https://mermaid.js.org/syntax/timeline.html
const DOCS_SAMPLE = `timeline
    title Timeline of Industrial Revolution
    section 17th-20th century
        Industry 1.0 : Machinery, Water power, Steam <br>power
        Industry 2.0 : Electricity, Internal combustion engine, Mass production
        Industry 3.0 : Electronics, Computers, Automation
    section 21st century
        Industry 4.0 : Internet, Robotics, Internet of Things
        Industry 5.0 : Artificial intelligence, Big data, 3D printing
`;

test("pasted timeline code renders every section, period and event", async ({ page }) => {
  const editor = await openEditor(page, "Timeline");
  await setCode(editor, DOCS_SAMPLE);
  // 2 sections + 5 periods + 5 events, each carrying a data-element-id
  await expect(editor.locator("svg [data-element-id]")).toHaveCount(12);
  await expect(editor.locator("svg text", { hasText: "Timeline of Industrial Revolution" }).first()).toBeVisible();
  await expect(editor.locator("svg text", { hasText: "21st century" }).first()).toBeVisible();
  await expect(editor.locator("svg text", { hasText: "Industry 4.0" }).first()).toBeVisible();
  // `<br>` became a real line break: the event text is split over two tspans
  await expect(editor.locator("svg text", { hasText: "Steam" }).first()).toBeVisible();
});

test("adding an event through the GUI writes `: text` back into the code", async ({ page }) => {
  const editor = await openEditor(page, "Timeline");
  expect(await codeText(editor)).toMatch(/^timeline/);

  // select a period on the canvas, then add an event into it
  await element(editor, "period-1").click();
  await expect(editor.getByRole("heading", { name: "Period" })).toBeVisible();
  await editor.getByRole("button", { name: "+ Event" }).click();

  const textField = editor.getByLabel("Event text");
  await expect(textField).toHaveValue("Event 1");
  await textField.fill("Bought by Microsoft");
  await textField.blur();

  // it landed on the period it was added to, after that period's own events
  await expectCode(editor).toContain("2002 : LinkedIn : Bought by Microsoft");

  await editor.getByRole("button", { name: "↓ Move down" }).click();
  await expectCode(editor).toContain("2002 : LinkedIn : Bought by Microsoft"); // already last: no wrap
  await editor.getByRole("button", { name: "↑ Move up" }).click();
  await expectCode(editor).toContain("2002 : Bought by Microsoft : LinkedIn");

  await editor.getByRole("button", { name: "Undo" }).click();
  await expectCode(editor).toContain("2002 : LinkedIn : Bought by Microsoft");
});

test("the toolbar adds a section and a period, and the property window reorders and deletes them", async ({ page }) => {
  const editor = await openEditor(page, "Timeline");
  await editor.getByRole("button", { name: "+ Section" }).click();
  const nameField = editor.getByLabel("Section name");
  await expect(nameField).toHaveValue("Section 1");
  await nameField.fill("Recent");
  await nameField.blur();
  await expectCode(editor).toContain("section Recent");

  // a new period goes into the selected section
  await editor.getByRole("button", { name: "+ Period" }).click();
  const labelField = editor.getByLabel("Period label");
  await labelField.fill("2010");
  await labelField.blur();
  await expectCode(editor).toMatch(/section Recent[\s\S]*2010/);

  // `:` has no escape in timeline text, so the edit is refused with a reason
  await labelField.fill("20:10");
  await expect(editor.getByText("`:` is not allowed (mermaid separator)")).toBeVisible();
  await expectCode(editor).toContain("2010");

  await labelField.fill("2010");
  await labelField.blur();
  await editor.getByRole("button", { name: "Delete period" }).click();
  await expectCode(editor).toContain("section Recent");
  await expectCode(editor).not.toContain("2010");
});

test("editing the title field updates the code", async ({ page }) => {
  const editor = await openEditor(page, "Timeline");
  const title = editor.getByLabel("Timeline title");
  await title.fill("My own history");
  await title.blur();
  await expectCode(editor).toContain("title My own history");
});
