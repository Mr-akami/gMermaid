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

test("the head selects are coupled to what mermaid can spell", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
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

test("an invisible link visibly gives up its label", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
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

// Three subgraphs inside each other: every dagre cluster adds border ranks, so
// the whole diagram used to stretch with the nesting depth.
const NESTED_SAMPLE = `flowchart TB
  subgraph g0["Outer"]
    subgraph g1["Middle"]
      subgraph g2["Inner"]
        a["A"] --> b["B"]
        b --> c["C"]
      end
    end
  end
`;

test("nested subgraph frames are drawn inside one another", async ({ page }) => {
  const editor = await openEditor(page, "Flowchart");
  await setCode(editor, NESTED_SAMPLE);

  const frame = async (id: string) => {
    const box = await element(editor, id).locator("rect").first().boundingBox();
    if (!box) throw new Error(`no frame for ${id}`);
    return box;
  };
  const outer = await frame("g0");
  const middle = await frame("g1");
  const inner = await frame("g2");
  for (const [parent, child] of [
    [outer, middle],
    [middle, inner],
  ] as const) {
    expect(child.x).toBeGreaterThan(parent.x);
    expect(child.y).toBeGreaterThan(parent.y);
    expect(child.x + child.width).toBeLessThan(parent.x + parent.width);
    expect(child.y + child.height).toBeLessThan(parent.y + parent.height);
  }
  // the three nodes sit one rank apart whatever the depth: the compound layout
  // this replaced stretched the innermost frame to ~700px for the same three
  expect(inner.height).toBeLessThan(400);

  // an edge inside the innermost frame stays inside it
  const a = (await element(editor, "a").locator("rect").first().boundingBox())!;
  const b = (await element(editor, "b").locator("rect").first().boundingBox())!;
  expect(b.y - (a.y + a.height)).toBeLessThan(120);
});
