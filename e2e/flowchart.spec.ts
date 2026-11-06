import { expect, test } from "@playwright/test";
import { clickPathMiddle, element, expectCode, openEditor, setCode, switchEditor } from "./helpers";

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

  // one page load for both: the second case starts from fresh code
  await test.step("the head selects are coupled to what mermaid can spell", async () => {
    const editor = await switchEditor(page, "Flowchart");
    await setCode(editor, 'flowchart TB\n  A["Start"] --> B["End"]\n');

    await element(editor, "edge-1").locator("path").first().click({ force: true });
    await expect(editor.getByRole("heading", { name: "Edge" })).toBeVisible();

    await editor.getByLabel("Edge end head").selectOption("cross");
    await expectCode(editor).toContain("A --x B");

    // mermaid has no token for a mismatched pair, so the end follows the start
    await editor.getByLabel("Edge start head").selectOption("circle");
    await expectCode(editor).toContain("A o--o B");
    await expect(editor.getByLabel("Edge start head")).toHaveValue("circle");
    await expect(editor.getByLabel("Edge end head")).toHaveValue("circle");

    // an invisible link has no head slots at all
    await editor.getByLabel("Edge line").selectOption("invisible");
    await expectCode(editor).toContain("A ~~~ B");
    await expect(editor.getByLabel("Edge start head")).toBeDisabled();
    await expect(editor.getByLabel("Edge end head")).toBeDisabled();
    await expect(editor.getByLabel("Edge start head")).toHaveValue("none");
    await expect(editor.getByLabel("Edge end head")).toHaveValue("none");
  });

  // one page load for both: the second case starts from fresh code
  await test.step("an invisible link visibly gives up its label", async () => {
    const editor = await switchEditor(page, "Flowchart");
    await setCode(editor, 'flowchart TB\n  A["Start"] -->|"go"| B["End"]\n');

    await element(editor, "edge-1").locator("path").first().click({ force: true });
    await expect(editor.getByLabel("Edge label")).toHaveValue("go");

    // `~~~` has no label slot, so the field empties and locks rather than
    // letting the label vanish only once the text is saved
    await editor.getByLabel("Edge line").selectOption("invisible");
    await expectCode(editor).toContain("A ~~~ B");
    await expect(editor.getByLabel("Edge label")).toBeDisabled();
    await expect(editor.getByLabel("Edge label")).toHaveValue("");
  });
});

// An edge's ends were the one thing the property window never named, and a
// self-loop is the one re-pointing the reducer refuses — a refusal that has to
// be SEEN, since the select would otherwise just snap back.
test("an edge names its ends, re-points one onto a subgraph, and says why a self-loop is refused", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(
    editor,
    `flowchart TB
  A["Start"] -- takes a while --> B["Middle"]
  subgraph g1["Group"]
    C["Done"]
  end
`,
  );
  await expectCode(editor).toContain('A -->|"takes a while"| B');

  await clickPathMiddle(page, editor, "edge-1");
  await expect(editor.getByRole("heading", { name: "Edge" })).toBeVisible();
  // named the way the canvas names them, not by their ids
  await expect(editor.getByLabel("From", { exact: true })).toHaveValue("A");
  await expect(editor.getByLabel("To", { exact: true })).toHaveValue("B");

  // a subgraph is a legal end, and the label survives the move
  await editor.getByLabel("To", { exact: true }).selectOption({ label: "Group" });
  await expectCode(editor).toContain('A -->|"takes a while"| g1');

  // pointing both ends at the same element is refused, with the reason shown
  await editor.getByLabel("To", { exact: true }).selectOption({ label: "Start" });
  await expect(editor.getByText("self-loop edges are not supported")).toBeVisible();
  await expectCode(editor).toContain('A -->|"takes a while"| g1');
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


test("paint: classDef/style render, and the Mark select writes a class", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, "flowchart LR\n  a[Old] --> b[New]\n  classDef removed fill:#fee2e2,stroke:#dc2626\n  class a removed\n  style b fill:#00ff00\n");
  await expect(element(editor, "a").locator("rect").first()).toHaveAttribute("fill", "#fee2e2");
  await expect(element(editor, "b").locator("rect").first()).toHaveAttribute("fill", "#00ff00");
  await expect(editor.locator(".code-warnings")).toHaveCount(0);

  await element(editor, "b").click();
  await editor.getByLabel("Mark").selectOption("added");
  await expectCode(editor).toContain("class b added");
  await expectCode(editor).toContain("classDef added fill:#dcfce7");

  await editor.getByLabel("Mark").selectOption("");
  await expectCode(editor).not.toContain("class b added");
});

test("move mode drags a node into a subgraph and back out", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, "flowchart LR\n  x[Loose] --> b\n  subgraph after[After]\n    b[Inside]\n  end\n");
  await editor.getByRole("button", { name: "Move mode" }).click();
  await expect(editor.getByText("drag a node onto a subgraph")).toBeVisible();

  const drag = async (id: string, to: { x: number; y: number }) => {
    const from = (await element(editor, id).locator("rect").first().boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
  };
  const inside = (await element(editor, "b").locator("rect").first().boundingBox())!;
  await drag("x", { x: inside.x + inside.width / 2, y: inside.y + inside.height / 2 });
  await expectCode(editor).toMatch(/subgraph after\["After"\]\n\s+x\["Loose"\]/);

  const canvas = (await editor.locator(".canvas").boundingBox())!;
  await drag("x", { x: canvas.x + canvas.width - 20, y: canvas.y + canvas.height - 20 });
  await expectCode(editor).toMatch(/^flowchart LR\n {2}x\["Loose"\]/);
});
