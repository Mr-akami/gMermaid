import { expect, test } from "@playwright/test";
import { clickPathMiddle, codeText, expectCode, mermaidVerdict, openEditor, setCode } from "./helpers";

test("the toolbar and property windows update the code text", async ({ page }) => {
  const editor = await openEditor(page, "ER");
  const props = editor.locator(".property-window");

  await editor.getByRole("button", { name: "+ Entity" }).click();
  await expect(props.getByRole("heading", { name: "Entity" })).toBeVisible();
  await props.getByLabel("Name", { exact: true }).fill("PRODUCT");
  await props.getByLabel("Alias").fill("Product");
  await expectCode(editor).toContain('PRODUCT["Product"]');

  // attributes: add, edit type / name / keys / comment
  await props.getByRole("button", { name: "+ Attribute" }).click();
  await props.getByLabel("Attribute 1 type").fill("int");
  await props.getByLabel("Attribute 1 name").fill("sku");
  await props.getByLabel("Attribute 1 PK").check();
  await props.getByLabel("Attribute 1 FK").check();
  await props.getByLabel("Attribute 1 comment").fill("stock unit");
  await expectCode(editor).toContain('int sku PK, FK "stock unit"');
  let code = await codeText(editor);
  expect(code).toContain('PRODUCT["Product"] {');

  // a second attribute, reordered above the first
  await props.getByRole("button", { name: "+ Attribute" }).click();
  await props.getByLabel("Attribute 2 name").fill("title");
  await props.getByRole("button", { name: "Move attribute 2 up" }).click();
  await expectCode(editor).toMatch(/string title\s+int sku PK, FK/);

  // a name mermaid cannot spell is refused in the toolbar hint, not stored
  await props.getByLabel("Attribute 1 name").fill("two words");
  await expect(editor.getByText(/name must be one word/)).toBeVisible();
  expect(await codeText(editor)).not.toContain("two words");

  await props.getByRole("button", { name: "Remove attribute 1" }).click();
  await expectCode(editor).not.toContain("string title");

  // the toolbar's Delete removes the selected entity again
  await editor.getByRole("button", { name: "Delete", exact: true }).click();
  await expectCode(editor).not.toContain("PRODUCT");
  code = await codeText(editor);
  expect(code).toContain("CUSTOMER");
  await expect(mermaidVerdict(editor, "ok")).toBeVisible({ timeout: 15_000 });
});

test("dragging between two entities creates a relationship the property window can edit", async ({ page }) => {
  const editor = await openEditor(page, "ER");
  const props = editor.locator(".property-window");

  await editor.getByRole("button", { name: "+ Entity" }).click();
  const source = editor.locator("svg g[data-drag='connect']").last();
  const target = editor.locator("svg g[data-drag='connect']").first();
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(props.getByRole("heading", { name: "Relationship" })).toBeVisible();
  await expectCode(editor).toContain("ENTITY1 ||--o{ CUSTOMER");

  await props.getByLabel("From cardinality").selectOption("zero-or-one");
  await props.getByLabel("To cardinality").selectOption("one-or-more");
  await props.getByLabel("Line").selectOption("non-identifying");
  await props.getByLabel("Label").fill("belongs to");
  await expectCode(editor).toContain('ENTITY1 |o..|{ CUSTOMER : "belongs to"');
  await expect(mermaidVerdict(editor, "ok")).toBeVisible({ timeout: 15_000 });
});

test("code edits render entities and relationships, and a relationship is re-pointed", async ({ page }) => {
  const editor = await openEditor(page, "ER");
  await setCode(
    editor,
    `erDiagram
  direction LR
  A {
    int id PK
  }
  B
  C
  A ||--o{ B : owns
`,
  );
  await expectCode(editor).toContain("A ||--o{ B");
  await expect(editor.locator("svg g[data-drag='connect']")).toHaveCount(3);

  await clickPathMiddle(page, editor, "relation-1");
  const props = editor.locator(".property-window");
  await expect(props.getByRole("heading", { name: "Relationship" })).toBeVisible();
  await expect(props.getByLabel("From", { exact: true })).toHaveValue("A");
  await expect(props.getByLabel("To", { exact: true })).toHaveValue("B");

  await props.getByLabel("To", { exact: true }).selectOption({ label: "C" });
  await expectCode(editor).toContain("A ||--o{ C");
  await props.getByRole("button", { name: "⇄ Swap ends" }).click();
  await expectCode(editor).toContain("C ||--o{ A");
});

test("styling statements are dropped with a warning", async ({ page }) => {
  const editor = await openEditor(page, "ER");
  await setCode(editor, `erDiagram\n  A ||--o{ B : x\n  style A fill:#f00\n`);
  await expect(editor.locator(".code-warnings")).toContainText("`style` is not represented in the editor");
  await expectCode(editor).toContain("A ||--o{ B");
});
