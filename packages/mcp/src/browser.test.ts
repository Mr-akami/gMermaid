import { afterEach, describe, expect, it } from "vitest";
import { BrowserReviewServer } from "./browser";
import { SessionStore } from "./session";

let server: BrowserReviewServer | undefined;
afterEach(() => server?.close());

describe("BrowserReviewServer", () => {
  it("serves a token-protected editor and accepts a validated confirmation", async () => {
    const sessions = new SessionStore();
    const session = sessions.create("flowchart", "flowchart TB\n  A --> B", "Review");
    server = new BrowserReviewServer(sessions, "<html><head></head><body>gMermaid</body></html>", async () => {});
    const url = await server.open(session.id);

    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("gMermaidBootstrap");

    const submitted = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mermaid: "flowchart TB\n  A --> C" }),
    });
    expect(submitted.status).toBe(200);
    expect(await submitted.json()).toMatchObject({ status: "confirmed", changed: true });
  });

  it("rejects an invalid token and a diagram-kind change", async () => {
    const sessions = new SessionStore();
    const session = sessions.create("sequence", "sequenceDiagram\n  A->>B: hi");
    server = new BrowserReviewServer(sessions, "<html><head></head></html>", async () => {});
    const url = await server.open(session.id);
    const invalidToken = new URL(url);
    invalidToken.searchParams.set("token", "wrong");
    expect((await fetch(invalidToken)).status).toBe(404);

    const changedKind = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mermaid: "classDiagram\n  class A" }),
    });
    expect(changedKind.status).toBe(400);
  });
});
