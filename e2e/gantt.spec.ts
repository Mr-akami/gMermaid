import { expect, test } from "@playwright/test";
import { codeText, element, expectCode, openEditor, setCode } from "./helpers";

// The sample from https://mermaid.js.org/syntax/gantt.html
const DOCS_SAMPLE = `gantt
    title A Gantt Diagram
    dateFormat YYYY-MM-DD
    section Section
        A task          :a1, 2014-01-01, 30d
        Another task    :after a1, 20d
    section Another
        Task in Another :2014-01-12, 12d
        another task    :24d
`;

test("pasted gantt code renders a bar per task and a band per section", async ({ page }) => {
  const editor = await openEditor(page, "Gantt");
  await setCode(editor, DOCS_SAMPLE);
  // 4 tasks + 2 sections, each carrying a data-element-id
  await expect(editor.locator("svg [data-element-id]")).toHaveCount(6);
  await expect(editor.locator('svg [data-element-id^="task-"] rect')).toHaveCount(4);
  await expect(editor.locator("svg text", { hasText: "A Gantt Diagram" }).first()).toBeVisible();
  await expect(editor.locator("svg text", { hasText: "Task in Another" }).first()).toBeVisible();
  // the axis is labelled with dates from the resolved domain
  await expect(editor.locator("svg text", { hasText: /^2014-0\d-\d\d$/ }).first()).toBeVisible();
});

test("adding a task through the GUI writes it back into the code", async ({ page }) => {
  const editor = await openEditor(page, "Gantt");
  expect(await codeText(editor)).toMatch(/^gantt/);

  // select a section band on the canvas, then add a task into it
  await element(editor, "section-2").click();
  await expect(editor.getByRole("heading", { name: "Section" })).toBeVisible();
  await editor.getByRole("button", { name: "+ Task" }).click();

  const nameField = editor.getByLabel("Task name");
  await expect(nameField).toHaveValue("Task 1");
  await nameField.fill("Write the docs");
  await nameField.blur();
  await editor.getByLabel("Task end value").fill("5d");
  await editor.getByLabel("Task end value").blur();
  await editor.getByLabel("Tag crit").check();

  await expectCode(editor).toContain("Write the docs :crit, 5d");
  // it landed in the section it was added to, after that section's own tasks
  const code = await codeText(editor);
  expect(code.indexOf("Write the docs")).toBeGreaterThan(code.indexOf("another task"));
  // the imported tasks keep their `task-N` import ids; the added one carries
  // the generated `tsk_` prefix
  await expect(editor.locator('svg [data-element-id^="task-"] rect, svg [data-element-id^="tsk_"] rect')).toHaveCount(5);
});

test("the property window edits start and end, and the toolbar edits the axis", async ({ page }) => {
  const editor = await openEditor(page, "Gantt");

  await editor.locator('svg [data-element-id^="task-"]').first().click();
  await expect(editor.getByRole("heading", { name: "Task" })).toBeVisible();
  await editor.getByLabel("Task start mode").selectOption("date");
  await editor.getByLabel("Task start value").fill("2014-02-01");
  await editor.getByLabel("Task start value").blur();
  await editor.getByLabel("Task end mode").selectOption("date");
  await editor.getByLabel("Task end value").fill("2014-02-20");
  await editor.getByLabel("Task end value").blur();
  await expectCode(editor).toContain("A task :a1, 2014-02-01, 2014-02-20");

  // reorder within the section
  await editor.getByRole("button", { name: "Move later" }).click();
  await expectCode(editor).toMatch(/Another task[\s\S]*A task/);
  await editor.getByRole("button", { name: "Undo" }).click();
  await expectCode(editor).toMatch(/A task[\s\S]*Another task/);

  await editor.getByLabel("Axis format").fill("%d/%m");
  await editor.getByLabel("Axis format").blur();
  await expectCode(editor).toContain("axisFormat %d/%m");
  await expect(editor.locator("svg text", { hasText: /^\d\d\/0\d$/ }).first()).toBeVisible();
});

test("the toolbar adds, renames and deletes a section", async ({ page }) => {
  const editor = await openEditor(page, "Gantt");
  await editor.getByRole("button", { name: "+ Section" }).click();
  const nameField = editor.getByLabel("Section name");
  await expect(nameField).toHaveValue("Section 3");
  await nameField.fill("Rollout");
  await nameField.blur();
  await expectCode(editor).toContain("section Rollout");

  await editor.getByRole("button", { name: "Move earlier" }).click();
  await expectCode(editor).toMatch(/section Rollout[\s\S]*section Another/);

  await editor.getByRole("button", { name: "Delete", exact: true }).click();
  await expectCode(editor).not.toContain("section Rollout");
});

// The gutter holds two things on one row — the section's name and its first
// task's name — and the axis can ask for more dates than fit beside each other.
test("the gutter and the axis stay legible when both are crowded", async ({ page }) => {
  const editor = await openEditor(page, "Gantt");
  await setCode(
    editor,
    `gantt
    title A schedule
    dateFormat YYYY-MM-DD
    axisFormat %Y-%m-%d
    section Design
        A very long task name here :a1, 2024-01-01, 30d
        Second task :a2, after a1, 20d
    section Build
        Third task :b1, 2024-02-20, 10d
`,
  );
  const sectionName = element(editor, "section-1").locator("text");
  const taskName = element(editor, "task-1").locator("text");
  await expect(sectionName).toBeVisible();
  const a = (await sectionName.boundingBox())!;
  const b = (await taskName.boundingBox())!;
  expect(a.x + a.width).toBeLessThanOrEqual(b.x + 1);

  // a crowded axis drops dates rather than stacking them on each other
  const dates = await editor.locator("svg text").filter({ hasText: /^\d{4}-\d\d-\d\d$/ }).all();
  const boxes = await Promise.all(dates.map(async (d) => (await d.boundingBox())!));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [p, q] = [boxes[i]!, boxes[j]!];
      expect(p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height).toBe(false);
    }
  }
});

test("a task name mermaid would read as a statement is refused with a reason", async ({ page }) => {
  const editor = await openEditor(page, "Gantt");
  await setCode(editor, "gantt\n  section Section\n  A task :a1, 2014-01-01, 30d\n");

  await element(editor, "task-1").click();
  const nameField = editor.getByLabel("Task name");
  await expect(nameField).toHaveValue("A task");

  // `title Plan :30d` is read back as the chart title, task and all
  await nameField.fill("title Plan");
  await expect(editor.getByText(/cannot start with a mermaid keyword/)).toBeVisible();
  await expectCode(editor).toContain("A task");

  await nameField.fill("");
  await expect(editor.getByText("task name cannot be empty")).toBeVisible();
  await expectCode(editor).toContain("A task");
});
