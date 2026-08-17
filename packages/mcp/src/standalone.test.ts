import { afterEach, describe, expect, it } from "vitest";
import { StandaloneEditorServer } from "./standalone";

let server: StandaloneEditorServer | undefined;
afterEach(() => server?.close());

describe("StandaloneEditorServer", () => {
  it("serves the editor on loopback and opens its URL", async () => {
    let opened: string | undefined;
    server = new StandaloneEditorServer("<html><body>gMermaid editor</body></html>", async (url) => {
      opened = url;
    });

    const url = await server.open();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(opened).toBe(url);
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("gMermaid editor");
  });

  it("does not expose other paths", async () => {
    server = new StandaloneEditorServer("<html></html>", async () => {});
    const url = await server.open();
    expect((await fetch(`${url}/missing`)).status).toBe(404);
  });
});
