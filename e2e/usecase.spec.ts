import { expect, test, type Locator } from "@playwright/test";
import { codeText, element, expectCode, openEditor, setCode } from "./helpers";

/** A canvas element by the text it shows. GUI-created elements carry a
 * generated `data-element-id`, so only parsed diagrams can be looked up by
 * name — everything the toolbar adds has to be found by its label. */
const node = (editor: Locator, text: string) =>
  editor.locator("svg g[data-element-id]").filter({ hasText: text }).first();

// The docs' defaults example (mermaid.js.org/syntax/usecase.html), plus a
// note and the actor variants / stereotypes from the sections below it.
const DOCS_SAMPLE = `usecase-beta
direction LR
actor Customer
actor Support("Support desk")@{ type: hollow, business: true } <<Employee>>
systemBoundary Storefront
  Browse("Browse catalogue")
  Checkout("Checkout") <<Core>>
end
systemBoundary fulfil["Fulfilment"]@{ type: package }
  Track("Track delivery")
end
Report[Generate report]
Customer --> Browse
Customer --> Checkout
Customer --> Track
Support --> Track
Support --o Report
Checkout ..> : include Browse
note for Checkout "validates the cart"
`;

test("typing the docs' sample into the code pane renders every element", async ({ page }) => {
  const editor = await openEditor(page, "Usecase");
  await setCode(editor, DOCS_SAMPLE);

  // 2 actors + 4 use cases are draggable nodes; ids are the mermaid names
  await expect(editor.locator("svg g[data-drag='connect']")).toHaveCount(6);
  // …plus 2 boundary frames, 6 relations and 1 note
  await expect(editor.locator("svg [data-element-id]")).toHaveCount(15);
  await expect(element(editor, "Checkout")).toBeVisible();
  await expect(element(editor, "Report")).toBeVisible();
  await expect(element(editor, "fulfil")).toContainText("Fulfilment");
  await expect(element(editor, "Support")).toContainText("«Employee»");
  await expect(element(editor, "Support")).toContainText("Support desk");
  // include names itself on the edge, as mermaid draws it
  await expect(element(editor, "relation-6")).toContainText("«include»");
  await expect(element(editor, "note-1")).toContainText("validates the cart");

  // a rectangular use case is a <rect>, an ellipse one is an <ellipse>
  await expect(element(editor, "Report").locator("rect")).toHaveCount(1);
  await expect(element(editor, "Browse").locator("ellipse")).toHaveCount(1);
});

test("the toolbar and property windows update the code text", async ({ page }) => {
  const editor = await openEditor(page, "Usecase");
  const props = editor.locator(".property-window");

  await editor.getByRole("button", { name: "+ Actor" }).click();
  await expect(props.getByRole("heading", { name: "Actor" })).toBeVisible();
  await props.getByLabel("Name").fill("GuiActor");
  await props.getByLabel("Label").fill("GUI actor");
  await props.getByLabel("Variant").selectOption("hollow");
  await props.getByLabel("Business").check();
  await props.getByLabel("Stereotype").fill("Employee");
  await expectCode(editor).toContain('actor GuiActor("GUI actor")@{ type: hollow, business: true } <<Employee>>');

  await editor.getByRole("button", { name: "+ Use case" }).click();
  await expect(props.getByRole("heading", { name: "Use case" })).toBeVisible();
  await props.getByLabel("Name").fill("GuiCase");
  await props.getByLabel("Label").fill("Do the thing");
  await expectCode(editor).toContain('GuiCase("Do the thing")');
  await props.getByLabel("Shape").selectOption("rect");
  await expectCode(editor).toContain('GuiCase["Do the thing"]');

  // a boundary owns its members: the use case moves inside its block
  await editor.getByRole("button", { name: "+ Boundary" }).click();
  await expect(props.getByRole("heading", { name: "Boundary" })).toBeVisible();
  await props.getByLabel("Name").fill("GuiBoundary");
  await props.getByLabel("Type").selectOption("package");
  await node(editor, "Do the thing").click();
  await props.getByLabel("Boundary").selectOption({ label: "GuiBoundary" });
  await expectCode(editor).toMatch(/systemBoundary GuiBoundary@\{ type: package \}\n {4}GuiCase\["Do the thing"\]\n {2}end/);

  // …and the toolbar's Delete takes the boundary away again, keeping members
  // only the frame's border and title take clicks — its middle belongs to
  // whatever sits inside it
  await node(editor, "GuiBoundary").locator("text").first().click();
  await expect(props.getByRole("heading", { name: "Boundary" })).toBeVisible();
  await editor.getByRole("button", { name: "Delete", exact: true }).click();
  await expectCode(editor).not.toContain("GuiBoundary");
  // the member survives its frame, back at the top level
  expect(await codeText(editor)).toContain('GuiCase["Do the thing"]');
});

test("connecting two elements writes a relation the property window can retype", async ({ page }) => {
  const editor = await openEditor(page, "Usecase");
  const props = editor.locator(".property-window");

  await editor.getByRole("button", { name: "+ Actor" }).click();
  await props.getByLabel("Name").fill("GuiActor");
  await editor.getByRole("button", { name: "+ Use case" }).click();
  await props.getByLabel("Name").fill("GuiCase");

  // the use case is selected: start a relation from it and click the actor
  await editor.getByRole("button", { name: "→ Relation from selected" }).click();
  await node(editor, "GuiActor").click();
  await expect(props.getByRole("heading", { name: "Relation" })).toBeVisible();
  await expectCode(editor).toContain("GuiCase --> GuiActor");

  await props.getByLabel("Label").fill("uses");
  await expectCode(editor).toContain('GuiCase -- "uses" --> GuiActor');

  // one marker per end: setting the source marker clears the target one
  await props.getByLabel("Marker at source").selectOption("circle");
  await expectCode(editor).toContain('GuiCase o-- "uses" -- GuiActor');

  await props.getByLabel("Relation kind").selectOption("include");
  await expectCode(editor).toContain("GuiCase ..> : include GuiActor");
});

test("dragging from a use case to an actor connects them", async ({ page }) => {
  const editor = await openEditor(page, "Usecase");
  const props = editor.locator(".property-window");

  // the sample already has actors and use cases; drag between two of them
  const source = element(editor, "Track");
  const target = element(editor, "Support");
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(props.getByRole("heading", { name: "Relation" })).toBeVisible();
  await expectCode(editor).toContain("Track --> Support");
});
