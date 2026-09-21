import { expect, test } from "@playwright/test";
import { clickPathMiddle, element, expectCode, openEditor, setCode } from "./helpers";

// Reversed and two-way relation tokens, a display label, both member
// classifiers, a note and a namespace — the depth the editor used to drop.
const DEEP_SAMPLE = `classDiagram
  class Animal {
    <<abstract>>
    +String name$
    +run()*
  }
  class Dog["A dog!"]
  Animal <|-- Dog
  note for Dog "good boy"
  namespace Pets {
    class Cat
  }
  Cat <--> Animal : friends
`;

test("reversed/two-way tokens, labels, classifiers, notes and namespaces round trip", async ({ page }) => {
  const editor = await openEditor(page, "Class");
  await setCode(editor, DEEP_SAMPLE);

  // 3 classes + 2 relations + 1 note + 1 namespace frame
  await expect(editor.locator("svg [data-element-id]")).toHaveCount(7);
  await expect(element(editor, "Animal")).toBeVisible();
  await expect(element(editor, "Cat")).toBeVisible();
  await expect(element(editor, "Pets")).toBeVisible();
  // the label replaces the class name on the canvas
  await expect(editor.locator("svg text", { hasText: "A dog!" })).toHaveCount(1);
  await expect(editor.locator("svg text", { hasText: "«abstract»" })).toHaveCount(1);
  // classifiers are styling, not text: `$` underlines, `*` italicizes
  await expect(editor.locator("svg text[text-decoration='underline']", { hasText: "+String name" })).toHaveCount(1);
  await expect(editor.locator("svg text[font-style='italic']", { hasText: "+run()" })).toHaveCount(1);
  // the reversed relation keeps its head at the start end
  await expect(element(editor, "relation-1").locator("path[marker-start]")).toHaveCount(1);

  await expectCode(editor).toContain("Animal <|-- Dog");
  await expectCode(editor).toContain("Cat <--> Animal : friends");
  await expectCode(editor).toContain('class Dog["A dog!"]');
  await expectCode(editor).toContain("+String name$");
  await expectCode(editor).toContain("+run()*");
  await expectCode(editor).toContain('note for Dog "good boy"');
  await expectCode(editor).toMatch(/namespace Pets \{[\s\S]*class Cat[\s\S]*\}/);
});

test("the property window swaps a relation's start head, changing the token", async ({ page }) => {
  const editor = await openEditor(page, "Class");
  await setCode(editor, DEEP_SAMPLE);

  await clickPathMiddle(page, editor, "relation-1");
  await expect(editor.getByRole("heading", { name: "Relation" })).toBeVisible();
  await expect(editor.getByLabel("Head (start)")).toHaveValue("inheritance");

  await editor.getByLabel("Head (start)").selectOption("composition");
  await expectCode(editor).toContain("Animal *-- Dog");
  await expectCode(editor).not.toContain("Animal <|-- Dog");

  // dropping the start head too leaves the bare link token
  await editor.getByLabel("Head (start)").selectOption("none");
  await expectCode(editor).toContain("Animal -- Dog");
});

test("+ Note attaches a note to the selected class", async ({ page }) => {
  const editor = await openEditor(page, "Class");
  // parsed diagrams key their elements by class name
  await setCode(editor, "classDiagram\n  class Animal\n  class Dog\n  Animal <|-- Dog\n");
  await element(editor, "Animal").locator("rect").first().click();
  await expect(editor.getByRole("heading", { name: "Class" })).toBeVisible();

  await editor.getByRole("button", { name: "+ Note" }).click();
  await expectCode(editor).toContain('note for Animal "note"');

  // the new note is selected: retarget it and retitle it from the window
  await expect(editor.getByRole("heading", { name: "Note" })).toBeVisible();
  const text = editor.getByLabel("Text");
  await text.fill("barks a lot");
  await text.blur();
  await expectCode(editor).toContain('note for Animal "barks a lot"');
});

test("+ Namespace wraps the selected class and the class window can move it out", async ({ page }) => {
  const editor = await openEditor(page, "Class");
  await setCode(editor, "classDiagram\n  class Animal\n  class Dog\n  Animal <|-- Dog\n");
  await element(editor, "Dog").locator("rect").first().click();
  await editor.getByRole("button", { name: "+ Namespace" }).click();
  await expectCode(editor).toMatch(/namespace Namespace1 \{[\s\S]*class Dog[\s\S]*\}/);

  await element(editor, "Dog").locator("rect").first().click();
  await expect(editor.getByLabel("Namespace")).not.toHaveValue("");
  await editor.getByLabel("Namespace").selectOption("");
  // the last member leaving prunes the namespace: mermaid has no empty one
  await expectCode(editor).not.toContain("namespace");
});
