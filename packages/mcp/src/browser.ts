import { createServer, type Server } from "node:http";
import open from "open";
import type { SessionStore } from "./session";
import { validateDiagram } from "./diagram";

const MAX_BODY_BYTES = 300 * 1024;

function json(res: import("node:http").ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

export class BrowserReviewServer {
  #server: Server | undefined;
  #origin: string | undefined;

  constructor(
    private readonly sessions: SessionStore,
    private readonly html: string,
    private readonly openUrl: (url: string) => Promise<unknown> = (url) => open(url, { wait: false }),
  ) {}

  async open(sessionId: string): Promise<string> {
    const origin = await this.#start();
    const session = this.sessions.getSession(sessionId);
    if (session === undefined) throw new Error("Review session expired");
    const url = `${origin}/review/${encodeURIComponent(session.id)}?token=${encodeURIComponent(session.token)}`;
    try {
      await this.openUrl(url);
    } catch (cause) {
      // Headless clients can still surface the returned localhost URL.
      console.error("Could not open the default browser:", cause instanceof Error ? cause.message : String(cause));
    }
    return url;
  }

  close(): void {
    this.#server?.close();
    this.#server = undefined;
    this.#origin = undefined;
  }

  async #start(): Promise<string> {
    if (this.#origin !== undefined) return this.#origin;
    this.#server = createServer((req, res) => void this.#handle(req, res));
    await new Promise<void>((resolve, reject) => {
      this.#server!.once("error", reject);
      this.#server!.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this.#server.address();
    if (address === null || typeof address === "string") throw new Error("Unable to bind browser review server");
    this.#origin = `http://127.0.0.1:${address.port}`;
    return this.#origin;
  }

  async #handle(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): Promise<void> {
    try {
      const origin = this.#origin ?? "http://127.0.0.1";
      const url = new URL(req.url ?? "/", origin);
      const match = url.pathname.match(/^\/review\/([^/]+)$/);
      if (match === null) return json(res, 404, { error: "Not found" });
      const id = decodeURIComponent(match[1]!);
      const token = url.searchParams.get("token") ?? undefined;
      const session = this.sessions.getSession(id, token);
      if (session === undefined) return json(res, 404, { error: "Unknown or expired review session" });

      if (req.method === "GET") {
        const bootstrap = JSON.stringify({
          mode: "browser",
          sessionId: session.id,
          kind: session.kind,
          mermaid: session.originalMermaid,
          title: session.title,
          token: session.token,
        }).replaceAll("<", "\\u003c");
        const html = this.html.replace("</head>", `<script>window.gMermaidBootstrap=${bootstrap}</script></head>`);
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'",
          "x-content-type-options": "nosniff",
        });
        res.end(html);
        return;
      }

      if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_BODY_BYTES) return json(res, 413, { error: "Request too large" });
        chunks.push(buffer);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { mermaid?: unknown };
      if (typeof body.mermaid !== "string") return json(res, 400, { error: "mermaid must be a string" });
      const validation = validateDiagram(body.mermaid, session.kind);
      if (!validation.ok) return json(res, 400, { error: validation.message });
      json(res, 200, this.sessions.confirm(id, body.mermaid, token));
    } catch (cause) {
      json(res, 500, { error: cause instanceof Error ? cause.message : String(cause) });
    }
  }
}
