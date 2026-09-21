import { expect, test } from "@playwright/test";
import { codeText, openEditor } from "./helpers";

const kinds = [
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
] as const;

for (const [kind, head] of kinds) {
  test(`${kind} tab renders a sample diagram and its code`, async ({ page }) => {
    const editor = await openEditor(page, kind);
    await expect(editor.locator("svg").first()).toBeVisible();
    // straight edges have a zero-width bbox, so count elements instead of visibility
    expect(await editor.locator("svg [data-element-id]").count()).toBeGreaterThan(1);
    expect(await codeText(editor)).toMatch(head);
  });
}
