import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSessionServer, type FileSessionInfo } from "./fileSession";
import { formatHandoff } from "./fileCommands";

const HTML = `<html><head><script>"</head>"</script></head><body></body></html>`;
const AGENT_TEXT = 'flowchart TB\n  A["Login"] --> B["Verify"]\n';

let dir: string;
let file: string;
let server: FileSessionServer;
let info: FileSessionInfo;

const api = (path: string, extra = "") => `${info.origin}${path}?token=${info.token}${extra}`;
const post = (path: string, body: unknown) =>
  fetch(api(path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "gmermaid-session-"));
  file = join(dir, "design.mmd");
  writeFileSync(file, AGENT_TEXT);
  server = new FileSessionServer({ file, displayName: "design.mmd", title: "Auth", html: HTML });
  info = await server.start();
});

afterEach(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The next SSE frame of `event`, parsed. */
async function nextEvent(res: Response, event: string, skip = 0): Promise<unknown> {
  const reader = res.body!.getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error("stream ended");
    buffer += new TextDecoder().decode(value);
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (frame.startsWith(`event: ${event}\n`) && skip-- === 0) {
        reader.releaseLock();
        return JSON.parse(frame.slice(frame.indexOf("data: ") + 6));
      }
    }
  }
}

describe("FileSessionServer", () => {
  it("refuses requests without the session token", async () => {
    expect((await fetch(`${info.origin}/api/ping`)).status).toBe(403);
  });

  it("serves the editor page with the file named in its bootstrap", async () => {
    const html = await (await fetch(info.url)).text();
    expect(html).toContain('"mode":"file"');
    expect(html).toContain('"file":"design.mmd"');
  });

  it("sends the file on connect and again when someone else changes it", async () => {
    const events = await fetch(api("/api/events"));
    expect(await nextEvent(events, "file")).toEqual({ text: AGENT_TEXT, kind: "flowchart" });
    const changed = `${AGENT_TEXT}  B --> C\n`;
    writeFileSync(file, changed);
    expect(await nextEvent(events, "file")).toEqual({ text: changed, kind: "flowchart" });
    await events.body!.cancel();
  });

  it("does not rewrite the file when the editor echoes what it loaded", async () => {
    const canonical = 'flowchart TB\n  A["Login"]\n  B["Verify"]\n  A --> B\n';
    expect(await (await post("/api/save", { mermaid: canonical })).json()).toEqual({ saved: false });
    expect(readFileSync(file, "utf8")).toBe(AGENT_TEXT);
  });

  it("saves the person's edit into the file", async () => {
    const edited = 'flowchart TB\n  A["Login"]\n  B["Verify"]\n  C["New"]\n  A --> B\n';
    expect(await (await post("/api/save", { mermaid: edited })).json()).toEqual({ saved: true });
    expect(readFileSync(file, "utf8")).toBe(edited);
  });

  it("refuses an edit that does not parse", async () => {
    expect((await post("/api/save", { mermaid: "flowchart TB\n  A -->\n" })).status).toBe(400);
    expect(readFileSync(file, "utf8")).toBe(AGENT_TEXT);
  });

  it("hands the file and comment to a waiting agent", async () => {
    const waiting = fetch(api("/api/wait", "&waitMs=5000"));
    await post("/api/handback", { mermaid: AGENT_TEXT, comment: "add an error branch" });
    const res = await waiting;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ round: 1, file: "design.mmd", edited: false, comment: "add an error branch", mermaid: AGENT_TEXT });
  });

  it("keeps a hand-off for an agent that was not waiting, folding repeats into one", async () => {
    const edited = 'flowchart TB\n  A["Login"]\n  B["Verify"]\n  C["New"]\n  A --> B\n';
    await post("/api/handback", { mermaid: edited, comment: "first" });
    await post("/api/handback", { mermaid: edited, comment: "second" });
    const h = await server.nextHandoff(0);
    expect(h).toEqual({ round: 2, file: "design.mmd", edited: true, comment: "first\n\nsecond", mermaid: edited });
    expect(await server.nextHandoff(0)).toBeUndefined();
  });

  it("answers 204 when nothing was handed back in time, 410 once closed", async () => {
    expect((await fetch(api("/api/wait", "&waitMs=50"))).status).toBe(204);
    const waiting = fetch(api("/api/wait", "&waitMs=5000"));
    await new Promise((r) => setTimeout(r, 50));
    server.close();
    expect((await waiting).status).toBe(410);
  });
});

describe("formatHandoff", () => {
  it("prints what the agent needs to act on", () => {
    expect(formatHandoff({ round: 2, file: "d.mmd", edited: true, comment: "line one\nline two", mermaid: "flowchart TB\n  A\n" })).toBe(
      [
        "The user handed back d.mmd (round 2).",
        "Edited by the user: yes",
        "Comment:",
        "  line one",
        "  line two",
        "Diagram as it now stands in the file:",
        "```mermaid",
        "flowchart TB\n  A",
        "```",
        "",
      ].join("\n"),
    );
  });
});
