import { expect, test } from "@playwright/test";
import { clipped, codeText, mermaidVerdict, openEditor, type Kind } from "./helpers";

// What every diagram kind owes the user on first open, one page load per kind:
// its sample renders, whole, with mermaid-valid code and the shared controls.
// (This used to be four separate loops — smoke, mermaid, clipping, controls —
// each paying for its own page loads.)

const KINDS: ReadonlyArray<readonly [Kind, RegExp]> = [
  ["Flowchart", /^flowchart /],
  ["Sequence", /^sequenceDiagram/],
  ["Class", /^classDiagram/],
  ["State", /^stateDiagram-v2/],
  ["Timeline", /^timeline/],
  ["Journey", /^journey/],
  ["Requirement", /^requirementDiagram/],
  ["Usecase", /^usecase-beta/],
  ["Mindmap", /^mindmap/],
  ["Gantt", /^gantt/],
];

for (const [kind, head] of KINDS) {
  test(`${kind}: the sample opens whole, mermaid-valid, with the shared controls`, async ({ page }) => {
    const editor = await openEditor(page, kind);

    // renders, and its code is this kind's
    await expect(editor.locator("svg").first()).toBeVisible();
    // straight edges have a zero-width bbox, so count elements instead of visibility
    expect(await editor.locator("svg [data-element-id]").count()).toBeGreaterThan(1);
    expect(await codeText(editor)).toMatch(head);

    // our codegen wrote it, so mermaid refusing it means the codegen is broken
    await expect(mermaidVerdict(editor, "ok")).toBeVisible({ timeout: 15_000 });

    // nothing opens cut off by the canvas
    expect(await clipped(editor)).toEqual([]);

    // undo/redo act on the whole document, so they sit in the app bar —
    // exactly one pair, the visible editor's
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Redo", exact: true })).toHaveCount(1);
    await expect(editor.getByLabel("Fit view")).toBeVisible();

    // delete acts on the selection, so it appears with one. The first drawn
    // element is not always clickable at its box centre (an edge, a box
    // behind its lifelines), so walk until one takes the click
    const selectionBar = editor.getByRole("toolbar", { name: "Selection actions" });
    await expect(selectionBar).toBeHidden();
    const elements = editor.locator("svg [data-element-id]");
    for (let i = 0; i < 6 && !(await selectionBar.isVisible()); i++) {
      await elements.nth(i).click({ force: true });
    }
    await expect(selectionBar.getByRole("button", { name: /^Delete/ })).toBeVisible();
  });
}
