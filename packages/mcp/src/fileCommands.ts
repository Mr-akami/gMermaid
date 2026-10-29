import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import open from "open";
import { FileSessionServer, type Handoff } from "./fileSession";
import { findEntry, isAlive, listEntries, removeEntry, writeEntry, type RegistryEntry } from "./registry";
import { validateDiagram } from "./diagram";

// The agent-facing half of a file session: `open` starts (or finds) the
// background server for a file and returns at once, `wait` collects the
// person's hand-offs, `close` and `status` manage them. Everything prints
// plain text an agent reads as-is; exit codes carry the outcome.

export const EXIT_TIMEOUT = 3;
export const EXIT_NOT_RUNNING = 4;

function displayName(file: string): string {
  const rel = relative(process.cwd(), file);
  return rel.startsWith("..") || rel === "" ? file : rel;
}

async function liveEntry(fileOrId: string): Promise<RegistryEntry | undefined> {
  const entry = findEntry(fileOrId);
  return entry !== undefined && (await isAlive(entry)) ? entry : undefined;
}

/** `gmermaid serve <file>`: the detached process `open` starts. */
export async function runServe(file: string, display: string, title: string | undefined, html: string): Promise<void> {
  const server = new FileSessionServer({ file, displayName: display, title, html, onClose: () => {
    removeEntry(file);
    process.exit(0);
  } });
  const info = await server.start();
  writeEntry({ id: info.id, file, origin: info.origin, token: info.token, url: info.url, pid: process.pid, startedAt: Date.now() });
  const stop = () => server.close();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

export async function runOpen(fileArg: string, opts: { title?: string | undefined; browser: boolean; cliPath: string }): Promise<number> {
  const file = resolve(fileArg);
  if (!existsSync(file)) {
    console.error(`${fileArg}: no such file. Write the diagram to it first, then open it.`);
    return 1;
  }
  const validation = validateDiagram(readFileSync(file, "utf8"));
  let entry = await liveEntry(file);
  if (entry === undefined) {
    const args = [opts.cliPath, "serve", file, "--display", displayName(file), ...(opts.title !== undefined ? ["--title", opts.title] : [])];
    spawn(process.execPath, args, { detached: true, stdio: "ignore", env: process.env }).unref();
    const deadline = Date.now() + 10_000;
    while (entry === undefined && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      const found = findEntry(file);
      if (found !== undefined && (await isAlive(found))) entry = found;
    }
    if (entry === undefined) {
      console.error("gMermaid could not start its local server.");
      return 1;
    }
  }
  if (opts.browser) {
    try {
      await open(entry.url, { wait: false });
    } catch {
      // headless: the URL below is still usable
    }
  }
  const name = displayName(file);
  console.log(`Showing ${name} in gMermaid: ${entry.url}`);
  if (!validation.ok) console.log(`Warning: the file does not open in the editor yet:\n${validation.message}`);
  console.log(`The file is shared. Edit it and the editor follows; the user's edits are saved into it.`);
  console.log(`Run \`gmermaid wait ${name}\` to receive the diagram when the user sends it back.`);
  return 0;
}

export function formatHandoff(h: Handoff): string {
  const lines = [
    `The user sent ${h.file} back (round ${h.round}).`,
    `Edited by the user: ${h.edited ? "yes" : "no"}`,
    h.comment === "" ? "Note: (none)" : `Note from the user:\n${h.comment.replace(/^/gm, "  ")}`,
    "Diagram as it now stands in the file:",
    "```mermaid",
    h.mermaid.trimEnd(),
    "```",
  ];
  return `${lines.join("\n")}\n`;
}

export async function runWait(fileOrId: string, opts: { timeoutSec: number; json: boolean }): Promise<number> {
  const entry = await liveEntry(fileOrId);
  if (entry === undefined) {
    console.error(`No gMermaid session is open for ${fileOrId}. Start one with \`gmermaid open <file>\`.`);
    return EXIT_NOT_RUNNING;
  }
  const deadline = Date.now() + opts.timeoutSec * 1000;
  for (;;) {
    const waitMs = Math.max(0, Math.min(30_000, deadline - Date.now()));
    let res: Response;
    try {
      res = await fetch(`${entry.origin}/api/wait?token=${entry.token}&waitMs=${waitMs}`);
    } catch {
      console.error("The gMermaid session ended.");
      return EXIT_NOT_RUNNING;
    }
    if (res.status === 200) {
      const h = (await res.json()) as Handoff;
      process.stdout.write(opts.json ? `${JSON.stringify(h)}\n` : formatHandoff(h));
      return 0;
    }
    if (res.status === 410) {
      console.error("The gMermaid session was closed before the user sent the diagram back.");
      return EXIT_NOT_RUNNING;
    }
    if (Date.now() >= deadline) {
      console.error(`The user has not sent the diagram back yet; the editor is still open. Run \`gmermaid wait ${fileOrId}\` again.`);
      return EXIT_TIMEOUT;
    }
  }
}

export async function runClose(fileOrId: string): Promise<number> {
  const entry = await liveEntry(fileOrId);
  if (entry === undefined) {
    console.error(`No gMermaid session is open for ${fileOrId}.`);
    return EXIT_NOT_RUNNING;
  }
  await fetch(`${entry.origin}/api/close?token=${entry.token}`, { method: "POST" }).catch(() => undefined);
  removeEntry(entry.file);
  console.log(`Closed the gMermaid session for ${displayName(entry.file)}.`);
  return 0;
}

export async function runStatus(): Promise<number> {
  const live: RegistryEntry[] = [];
  for (const e of listEntries()) if (await isAlive(e)) live.push(e);
  if (live.length === 0) console.log("No gMermaid sessions are open.");
  for (const e of live) console.log(`${displayName(e.file)}\t${e.url}`);
  return 0;
}
