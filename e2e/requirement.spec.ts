import { expect, test } from "@playwright/test";
import { codeText, element, openEditor, setCode } from "./helpers";

// The docs' "Larger Example" (mermaid.js.org/syntax/requirementDiagram.html):
// 6 requirements + 3 elements + 8 relations, including the mirrored `<-` form.
const DOCS_SAMPLE = `requirementDiagram

requirement test_req {
id: 1
text: the test text.
risk: high
verifymethod: test
}

functionalRequirement test_req2 {
id: 1.1
text: the second test text.
risk: low
verifymethod: inspection
}

performanceRequirement test_req3 {
id: 1.2
text: the third test text.
risk: medium
verifymethod: demonstration
}

interfaceRequirement test_req4 {
id: 1.2.1
text: the fourth test text.
risk: medium
verifymethod: analysis
}

physicalRequirement test_req5 {
id: 1.2.2
text: the fifth test text.
risk: medium
verifymethod: analysis
}

designConstraint test_req6 {
id: 1.2.3
text: the sixth test text.
risk: medium
verifymethod: analysis
}

element test_entity {
type: simulation
}

element test_entity2 {
type: word doc
docRef: reqs/test_entity
}

element test_entity3 {
type: "test suite"
docRef: github.com/all_the_tests
}

test_entity - satisfies -> test_req2
test_req - traces -> test_req2
test_req - contains -> test_req3
test_req3 - contains -> test_req4
test_req4 - derives -> test_req5
test_req5 - refines -> test_req6
test_entity3 - verifies -> test_req5
test_req <- copies - test_entity2
`;

test("typing the docs' sample into the code pane renders every node and edge", async ({ page }) => {
  const editor = await openEditor(page, "Requirement");
  await setCode(editor, DOCS_SAMPLE);

  // 9 boxes (6 requirements + 3 elements) and 8 relation edges
  await expect(editor.locator("svg g[data-drag='connect']")).toHaveCount(9);
  await expect(editor.locator("svg [data-element-id]")).toHaveCount(17);
  await expect(element(editor, "test_req4")).toBeVisible();
  await expect(element(editor, "test_entity3")).toBeVisible();

  // the type header, the fields and the relation label reach the canvas
  await expect(element(editor, "test_req4")).toContainText("«interfaceRequirement»");
  await expect(element(editor, "test_req4")).toContainText("Risk: Medium");
  await expect(element(editor, "test_entity3")).toContainText("Doc Ref: github.com/all_the_tests");
  await expect(element(editor, "relation-1")).toContainText("«satisfies»");
  // the mirrored `test_req <- copies - test_entity2` becomes an ordinary edge
  await expect(element(editor, "relation-8")).toContainText("«copies»");
});

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
  expect(await codeText(editor)).toContain("physicalRequirement gui_req {");

  // elements get their own fields
  await editor.getByRole("button", { name: "+ Element" }).click();
  await expect(props.getByRole("heading", { name: "Element" })).toBeVisible();
  await props.getByLabel("Type").fill("word doc");
  await props.getByLabel("Doc ref").fill("docs/new");
  code = await codeText(editor);
  expect(code).toContain("element new_element1 {");
  expect(code).toContain('docref: "docs/new"');

  // …and the toolbar's Delete removes the selected one again
  await editor.getByRole("button", { name: "Delete", exact: true }).click();
  expect(await codeText(editor)).not.toContain("new_element1");
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
  expect(await codeText(editor)).toContain("- satisfies -> ");
  await props.getByLabel("Type").selectOption("derives");
  expect(await codeText(editor)).toContain("- derives -> ");
});
