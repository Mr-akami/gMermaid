import { expect, test } from "@playwright/test";
import { clickPathMiddle, codeText, expectCode, openEditor, setCode } from "./helpers";


test("the toolbar and property windows update the code text", async ({ page }) => {
  const editor = await openEditor(page, "Requirement");
  const props = editor.locator(".property-window");

  await editor.getByRole("button", { name: "+ Requirement" }).click();
  await expect(props.getByRole("heading", { name: "Requirement" })).toBeVisible();
  await props.getByLabel("Type").selectOption("physicalRequirement");
  await props.getByLabel("Id", { exact: true }).fill("2.1");
  await props.getByLabel("Text").fill("added from the GUI");
  await props.getByLabel("Risk").selectOption("High");
  await props.getByLabel("Verify method").selectOption("Demonstration");

  // wait for the last field to land; the pane trails a GUI edit for a moment
  await expectCode(editor).toContain("verifymethod: demonstration");
  let code = await codeText(editor);
  expect(code).toContain("physicalRequirement new_req1 {");
  expect(code).toContain('id: "2.1"');
  expect(code).toContain('text: "added from the GUI"');
  expect(code).toContain("risk: high");
  expect(code).toContain("verifymethod: demonstration");
  // the new requirement is on the canvas too (sample's 2 boxes + this one)
  await expect(editor.locator("svg g[data-drag='connect']")).toHaveCount(3);

  // renaming goes through the same property window
  await props.getByLabel("Name").fill("gui_req");
  await expectCode(editor).toContain("physicalRequirement gui_req {");

  // elements get their own fields
  await editor.getByRole("button", { name: "+ Element" }).click();
  await expect(props.getByRole("heading", { name: "Element" })).toBeVisible();
  await props.getByLabel("Type").fill("word doc");
  await props.getByLabel("Doc ref").fill("docs/new");
  await expectCode(editor).toContain('docref: "docs/new"');
  code = await codeText(editor);
  expect(code).toContain("element new_element1 {");
  expect(code).toContain('docref: "docs/new"');

  // …and the toolbar's Delete removes the selected one again
  await editor.getByRole("button", { name: "Delete", exact: true }).click();
  await expectCode(editor).not.toContain("new_element1");
});

test("dragging between two nodes creates a relation the property window can retype", async ({ page }) => {
  const editor = await openEditor(page, "Requirement");
  const props = editor.locator(".property-window");

  // the sample's element and requirement are already connected; add a
  // second requirement and wire it up by dragging
  await editor.getByRole("button", { name: "+ Requirement" }).click();
  const source = editor.locator("svg g[data-drag='connect']").last();
  const target = editor.locator("svg g[data-drag='connect']").first();
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(props.getByRole("heading", { name: "Relation" })).toBeVisible();
  await expectCode(editor).toContain("- satisfies -> ");
  await props.getByLabel("Type").selectOption("derives");
  await expectCode(editor).toContain("- derives -> ");
});

// A relation whose only other property is its type is indistinguishable from
// its neighbours until the property window names the two nodes it joins —
// which may be a requirement OR an element, out of one mermaid name space.
test("a relation names its ends and is re-pointed across requirements and elements", async ({ page }) => {
  const editor = await openEditor(page, "Requirement");
  await setCode(
    editor,
    `requirementDiagram
requirement first {
id: 1
}
requirement second {
id: 2
}
element probe {
type: simulation
}
first - satisfies -> probe
`,
  );
  await expectCode(editor).toContain("first - satisfies -> probe");

  await clickPathMiddle(page, editor, "relation-1");
  const props = editor.locator(".property-window");
  await expect(props.getByRole("heading", { name: "Relation" })).toBeVisible();
  await expect(props.getByLabel("From", { exact: true })).toHaveValue("first");
  await expect(props.getByLabel("To", { exact: true })).toHaveValue("probe");

  // the type rides along instead of being redrawn
  await props.getByLabel("To", { exact: true }).selectOption({ label: "second" });
  await expectCode(editor).toContain("first - satisfies -> second");
  await expectCode(editor).not.toContain("first - satisfies -> probe");

  await props.getByRole("button", { name: "⇄ Swap ends" }).click();
  await expectCode(editor).toContain("second - satisfies -> first");
});
