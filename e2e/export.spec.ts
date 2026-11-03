import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { openEditor } from "./helpers";

test("exports the canvas as a standalone SVG and a 2x PNG", async ({ page }) => {
  await openEditor(page, "Flowchart");

  const svgDl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG" }).click();
  const svgFile = await svgDl;
  expect(svgFile.suggestedFilename()).toBe("flowchart.svg");
  const svg = await readFile((await svgFile.path())!, "utf8");
  expect(svg).toContain("<svg");
  expect(svg).toContain("viewBox");
  expect(svg).not.toContain("var(");

  const pngDl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PNG" }).click();
  const pngFile = await pngDl;
  expect(pngFile.suggestedFilename()).toBe("flowchart.png");
  const png = await readFile((await pngFile.path())!);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
});
