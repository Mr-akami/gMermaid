import { describe, expect, it } from "vitest";
import { injectBootstrap } from "./bootstrap";

describe("injectBootstrap", () => {
  it("inserts before the real </head>, not one inside the bundle's code", () => {
    const html = `<html><head><script>const s = "</head>";</script></head><body></body></html>`;
    const out = injectBootstrap(html, { a: "</script>" });
    expect(out).toContain(`const s = "</head>";</script><script>window.gMermaidBootstrap=`);
    expect(out).not.toContain("</script>\"}");
  });
});
