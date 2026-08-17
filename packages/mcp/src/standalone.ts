import { createServer, type Server } from "node:http";
import open from "open";

export class StandaloneEditorServer {
  #server: Server | undefined;
  #origin: string | undefined;

  constructor(
    private readonly html: string,
    private readonly openUrl: (url: string) => Promise<unknown> = (url) => open(url, { wait: false }),
  ) {}

  async open(): Promise<string> {
    const origin = await this.#start();
    try {
      await this.openUrl(origin);
    } catch (cause) {
      console.error("Could not open the default browser:", cause instanceof Error ? cause.message : String(cause));
    }
    return origin;
  }

  close(): void {
    this.#server?.close();
    this.#server = undefined;
    this.#origin = undefined;
  }

  async #start(): Promise<string> {
    if (this.#origin !== undefined) return this.#origin;
    this.#server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "GET" || (url.pathname !== "/" && url.pathname !== "/index.html")) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'",
        "x-content-type-options": "nosniff",
      });
      res.end(this.html);
    });
    await new Promise<void>((resolve, reject) => {
      this.#server!.once("error", reject);
      this.#server!.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this.#server.address();
    if (address === null || typeof address === "string") throw new Error("Unable to bind gMermaid server");
    this.#origin = `http://127.0.0.1:${address.port}`;
    return this.#origin;
  }
}
