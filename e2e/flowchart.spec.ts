import { expect, test } from "@playwright/test";
import { element, expectCode, openEditor, setCode } from "./helpers";

// The three things the edge model, the shape registry and the id-less
// subgraph form add on top of the old `-->`-only flowchart.
const DEEP_SAMPLE = `flowchart LR
  A["Start"] <--> B["Middle"]
  B --o C@{ shape: doc, label: "Report" }
  C -- takes a while ---> D@{ shape: hourglass, label: "Wait" }
  subgraph My Group
    direction TB
    D --> E["Done"]
  end
`;

test("bidirectional, circle-head and `@{ shape }` syntax round trip", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, DEEP_SAMPLE);

  // 5 nodes + 4 edges + 1 subgraph
  await expect(editor.locator("svg [data-element-id]")).toHaveCount(10);
  await expect(element(editor, "C")).toBeVisible();
  await expect(element(editor, "subGraph0")).toBeVisible();
  // the double head is drawn at BOTH ends of the first edge
  const both = element(editor, "edge-1").locator("path[marker-start][marker-end]");
  await expect(both).toHaveCount(1);

  await expectCode(editor).toContain("A <--> B");
  await expectCode(editor).toContain("B --o C");
  await expectCode(editor).toContain('C@{ shape: doc, label: "Report" }');
  await expectCode(editor).toContain('D@{ shape: hourglass, label: "Wait" }');
  // extra dashes survive as edge length
  await expectCode(editor).toContain('C --->|"takes a while"| D');
  // the id-less block keeps its title under a synthesized id
  await expectCode(editor).toContain('subgraph subGraph0["My Group"]');
  await expectCode(editor).toContain("direction TB");
});

test("the property window changes a node shape to both the `@{}` and the bracket form", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, 'flowchart TB\n  A["Start"] --> B["End"]\n');

  await element(editor, "A").click();
  await expect(editor.getByRole("heading", { name: "Node" })).toBeVisible();

  // a shape with no bracket syntax must be emitted as `@{ shape: … }`
  await editor.getByLabel("Shape").selectOption("doc");
  await expectCode(editor).toContain('A@{ shape: doc, label: "Start" }');

  // …and one that has a bracket form goes back to it
  await editor.getByLabel("Shape").selectOption("stadium");
  await expectCode(editor).toContain('A(["Start"])');
  await expectCode(editor).not.toContain("@{");
});

test("the property window edits an edge's heads, line style and length", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, 'flowchart TB\n  A["Start"] --> B["End"]\n');

  // a straight edge has a zero-width bbox, so playwright never calls it
  // "visible" — click its wide transparent hit path outright
  await element(editor, "edge-1").locator("path").first().click({ force: true });
  await expect(editor.getByRole("heading", { name: "Edge" })).toBeVisible();

  await editor.getByLabel("Edge end head").selectOption("circle");
  await expectCode(editor).toContain("A --o B");

  await editor.getByLabel("Edge start head").selectOption("circle");
  await expectCode(editor).toContain("A o--o B");

  await editor.getByLabel("Edge line").selectOption("thick");
  await expectCode(editor).toContain("A o==o B");

  await editor.getByLabel("Edge length").fill("3");
  await expectCode(editor).toContain("A o====o B");
});

test("a subgraph's direction is editable from the property window", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, 'flowchart TB\n  subgraph g1["Group"]\n    A["A"]\n  end\n');

  // the frame's hit target is its border and title
  await element(editor, "g1").locator("text").click();
  await expect(editor.getByRole("heading", { name: "Subgraph" })).toBeVisible();

  await editor.getByLabel("Subgraph direction").selectOption("LR");
  await expectCode(editor).toContain("direction LR");

  await editor.getByLabel("Subgraph direction").selectOption("");
  await expectCode(editor).not.toContain("direction LR");
});
