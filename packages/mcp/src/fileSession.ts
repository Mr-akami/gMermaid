import { randomUUID } from "node:crypto";
import { readFileSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, dirname } from "node:path";
import { injectBootstrap } from "./bootstrap";
import { canonicalMermaid, detectKind, validateDiagram, type DiagramKind } from "./diagram";

// One file, shown in the browser, shared between an agent and a person.
//
// The FILE is the master copy. The agent edits it with its own tools and the
// editor follows (watched, pushed over SSE); the person edits in the editor
// and every edit is written straight back, so the agent can read the file at
// any time. "Hand back" is the only explicit step: it queues a hand-off —
// the file as it stands plus the person's comment — for `gmermaid wait`.
// The session survives any number of rounds.

const MAX_BODY_BYTES = 300 * 1024;

/** What the editor is told about the file: its text, and whether it opens. */
export interface FileSnapshot {
  readonly text: string;
  readonly kind?: DiagramKind | undefined;
  /** Why the file does not open, when it does not. */
  readonly error?: string | undefined;
}

export interface Handoff {
  readonly round: number;
  readonly file: string;
  /** Whether the person changed the diagram since the previous hand-off (or
   * since the session opened). The agent's own edits do not count. */
  readonly edited: boolean;
  readonly comment: string;
  readonly mermaid: string;
}

export interface FileSessionOptions {
  /** Absolute path of the shared file. */
  readonly file: string;
  /** How the file is named to the person (usually relative to the project). */
  readonly displayName: string;
  readonly title?: string | undefined;
  readonly html: string;
  /** Close after this long with no editor connected and no agent waiting. */
  readonly idleMs?: number | undefined;
  readonly onClose?: (() => void) | undefined;
}

export interface FileSessionInfo {
  readonly id: string;
  readonly token: string;
  readonly origin: string;
  readonly url: string;
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request too large");
    chunks.push(buffer);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  if (typeof value !== "object" || value === null) throw new Error("Expected a JSON object");
  return value as Record<string, unknown>;
}

export function snapshotOf(text: string): FileSnapshot {
  const kind = detectKind(text);
  const validation = validateDiagram(text);
  return validation.ok ? { text, kind } : { text, kind, error: validation.message };
}

export class FileSessionServer {
  readonly id = randomUUID();
  readonly token = randomUUID();
  #server: Server | undefined;
  #watcher: FSWatcher | undefined;
  #origin: string | undefined;
  /** The file as last read or written by us — an echo of our own write is
   * not news. */
  #text: string;
  #editedSinceRound = false;
  #round = 0;
  #pending: Handoff | undefined;
  readonly #waiters = new Set<(h: Handoff | undefined) => void>();
  readonly #clients = new Set<ServerResponse>();
  #idleTimer: NodeJS.Timeout | undefined;
  #debounce: NodeJS.Timeout | undefined;
  #closed = false;

  constructor(private readonly opts: FileSessionOptions) {
    this.#text = readFileSync(opts.file, "utf8");
  }

  async start(): Promise<FileSessionInfo> {
    this.#server = createServer((req, res) => void this.#handle(req, res));
    await new Promise<void>((resolve, reject) => {
      this.#server!.once("error", reject);
      this.#server!.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this.#server.address();
    if (address === null || typeof address === "string") throw new Error("Unable to bind gMermaid server");
    this.#origin = `http://127.0.0.1:${address.port}`;
    // watch the directory, not the file: editors save by replacing the file,
    // which silently ends a watch on the old inode
    const name = basename(this.opts.file);
    this.#watcher = watch(dirname(this.opts.file), (_event, changed) => {
      if (changed !== null && changed.toString() !== name) return;
      clearTimeout(this.#debounce);
      this.#debounce = setTimeout(() => this.#reread(), 80);
    });
    this.#armIdle();
    return { id: this.id, token: this.token, origin: this.#origin, url: `${this.#origin}/?token=${this.token}` };
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#idleTimer);
    clearTimeout(this.#debounce);
    this.#watcher?.close();
    for (const wake of this.#waiters) wake(undefined);
    this.#waiters.clear();
    for (const client of this.#clients) client.end();
    this.#clients.clear();
    // stop taking requests now, but let the agents just woken above get
    // their 410 before the sockets go
    this.#server?.close();
    const server = this.#server;
    setTimeout(() => {
      server?.closeAllConnections();
      this.opts.onClose?.();
    }, 50);
  }

  /** The next hand-off, waiting up to `waitMs` for one. Undefined on timeout
   * or when the session closes. */
  async nextHandoff(waitMs: number): Promise<Handoff | undefined> {
    if (this.#pending !== undefined || waitMs <= 0 || this.#closed) return this.#take();
    return new Promise((resolve) => {
      const wake = (h: Handoff | undefined) => {
        clearTimeout(timer);
        this.#waiters.delete(wake);
        this.#armIdle();
        resolve(h);
      };
      const timer = setTimeout(() => wake(this.#take()), waitMs);
      this.#waiters.add(wake);
      this.#armIdle();
    });
  }

  #take(): Handoff | undefined {
    const h = this.#pending;
    this.#pending = undefined;
    return h;
  }

  /** An edit from the editor: write it unless it is the file's own text
   * coming back (the editor always echoes what it just loaded). */
  save(mermaid: string): { saved: boolean } {
    const validation = validateDiagram(mermaid);
    if (!validation.ok) throw new Error(validation.message);
    if (mermaid === this.#text || mermaid === canonicalMermaid(this.#text)) return { saved: false };
    writeFileSync(this.opts.file, mermaid);
    this.#text = mermaid;
    this.#editedSinceRound = true;
    return { saved: true };
  }

  handBack(mermaid: string, comment: string): Handoff {
    this.save(mermaid);
    this.#round += 1;
    // hand-offs the agent has not collected yet fold into this one: the file
    // is the same, and no comment is lost
    const earlier = this.#pending;
    const h: Handoff = {
      round: this.#round,
      file: this.opts.displayName,
      edited: this.#editedSinceRound || (earlier?.edited ?? false),
      comment: [earlier?.comment, comment.trim()].filter((c) => c !== undefined && c !== "").join("\n\n"),
      mermaid: this.#text,
    };
    this.#editedSinceRound = false;
    this.#pending = h;
    const [wake] = this.#waiters;
    if (wake !== undefined) wake(this.#take());
    this.#broadcast("handoff", { round: h.round });
    return h;
  }

  #reread(): void {
    let text: string;
    try {
      text = readFileSync(this.opts.file, "utf8");
    } catch {
      return; // mid-replace; the next event brings the new file
    }
    if (text === this.#text) return;
    this.#text = text;
    this.#broadcast("file", snapshotOf(text));
  }

  #broadcast(event: string, data: unknown): void {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.#clients) client.write(frame);
  }

  #armIdle(): void {
    clearTimeout(this.#idleTimer);
    if (this.#closed || this.#clients.size > 0 || this.#waiters.size > 0) return;
    this.#idleTimer = setTimeout(() => this.close(), this.opts.idleMs ?? 2 * 60 * 60_000);
    this.#idleTimer.unref();
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", this.#origin ?? "http://127.0.0.1");
      if (url.searchParams.get("token") !== this.token) return json(res, 403, { error: "Forbidden" });
      const route = `${req.method} ${url.pathname}`;

      if (route === "GET /") {

        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'",
          "x-content-type-options": "nosniff",
        });
        res.end(
          injectBootstrap(this.opts.html, {
            mode: "file",
            sessionId: this.id,
            token: this.token,
            file: this.opts.displayName,
            title: this.opts.title,
          }),
        );
        return;
      }
      if (route === "GET /api/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write(`event: file\ndata: ${JSON.stringify(snapshotOf(this.#text))}\n\n`);
        this.#clients.add(res);
        this.#armIdle();
        req.on("close", () => {
          this.#clients.delete(res);
          this.#armIdle();
        });
        return;
      }
      if (route === "GET /api/ping") return json(res, 200, { id: this.id, file: this.opts.file });
      if (route === "GET /api/wait") {
        const waitMs = Math.min(Math.max(Number(url.searchParams.get("waitMs") ?? 0) || 0, 0), 60_000);
        const h = await this.nextHandoff(waitMs);
        if (h !== undefined) return json(res, 200, h);
        if (this.#closed) return json(res, 410, { error: "Session closed" });
        res.writeHead(204, { "cache-control": "no-store" }).end();
        return;
      }
      if (route === "POST /api/save") {
        const body = await readJson(req);
        if (typeof body.mermaid !== "string") return json(res, 400, { error: "mermaid must be a string" });
        return json(res, 200, this.save(body.mermaid));
      }
      if (route === "POST /api/handback") {
        const body = await readJson(req);
        if (typeof body.mermaid !== "string") return json(res, 400, { error: "mermaid must be a string" });
        const comment = typeof body.comment === "string" ? body.comment : "";
        return json(res, 200, { round: this.handBack(body.mermaid, comment).round });
      }
      if (route === "POST /api/close") {
        json(res, 200, { closed: true });
        setImmediate(() => this.close());
        return;
      }
      return json(res, 404, { error: "Not found" });
    } catch (cause) {
      json(res, 400, { error: cause instanceof Error ? cause.message : String(cause) });
    }
  }
}
