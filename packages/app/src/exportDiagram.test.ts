// @vitest-environment jsdom
import { expect, it } from "vitest";
import { buildExportSvg, inlineCssVars } from "./exportDiagram";

it("resolves vars, falls back, handles nested parens", () => {
  const r = (n: string) => (n === "--gm-stroke" ? "#111" : undefined);
  expect(inlineCssVars('stroke="var(--gm-stroke, #333)"', r)).toBe('stroke="#111"');
  expect(inlineCssVars('fill="var(--gm-frag-fill, rgba(1,2,3,0.5))"', r)).toBe('fill="rgba(1,2,3,0.5)"');
  expect(inlineCssVars("var(--a, var(--gm-stroke, red))", r)).toBe("#111");
  expect(inlineCssVars("none", r)).toBe("none");
});

it("builds a standalone svg: no viewport transform, band dropped, bg + viewBox", () => {
  document.body.innerHTML = `<svg width="100%" height="100%" style="touch-action:none">
    <defs><marker id="gm-arrow"><path fill="var(--gm-stroke, #333)"/></marker></defs>
    <g transform="translate(5 5) scale(2)" data-gm-root=""><rect fill="var(--gm-node-fill, #fff)"/></g>
    <g class="band"><rect/></g></svg>`;
  const src = document.querySelector("svg") as unknown as SVGSVGElement;
  const out = buildExportSvg(src, { box: { x: 0, y: 0, w: 100, h: 50 }, background: "#fafafa", resolveVar: () => undefined });
  expect(out.width).toBe(132);
  expect(out.height).toBe(82);
  expect(out.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(out.svg).toContain('viewBox="-16 -16 132 82"');
  expect(out.svg).toContain('fill="#fafafa"');
  expect(out.svg).toContain('fill="#333"');
  expect(out.svg).not.toContain("var(");
  expect(out.svg).not.toContain("transform");
  expect(out.svg).not.toContain("band");
  expect(out.svg).not.toContain("touch-action");
  // source untouched
  expect(src.querySelector("[data-gm-root]")?.getAttribute("transform")).toContain("scale(2)");
});
