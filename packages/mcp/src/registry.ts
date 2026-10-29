import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Where a running file session can be found by the CLI calls that come after
// `gmermaid open`: one small JSON per shared file, keyed by its absolute
// path. It holds the session's token, so it is written owner-only.

export interface RegistryEntry {
  readonly id: string;
  readonly file: string;
  readonly origin: string;
  readonly token: string;
  readonly url: string;
  readonly pid: number;
  readonly startedAt: number;
}

export function stateDir(): string {
  if (process.env.GMERMAID_STATE_DIR !== undefined) return process.env.GMERMAID_STATE_DIR;
  const base = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(base, "gmermaid", "sessions");
}

function entryPath(file: string): string {
  return join(stateDir(), `${createHash("sha256").update(resolve(file)).digest("hex").slice(0, 16)}.json`);
}

export function writeEntry(entry: RegistryEntry): void {
  mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  writeFileSync(entryPath(entry.file), JSON.stringify(entry), { mode: 0o600 });
}

export function removeEntry(file: string): void {
  rmSync(entryPath(file), { force: true });
}

export function listEntries(): RegistryEntry[] {
  let names: string[];
  try {
    names = readdirSync(stateDir());
  } catch {
    return [];
  }
  const out: RegistryEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(readFileSync(join(stateDir(), name), "utf8")) as RegistryEntry);
    } catch {
      // half-written or foreign; ignore
    }
  }
  return out;
}

/** The entry for a file path or a session id. */
export function findEntry(fileOrId: string): RegistryEntry | undefined {
  const file = resolve(fileOrId);
  return listEntries().find((e) => e.file === file || e.id === fileOrId);
}

/** Whether the session behind an entry still answers. A dead one is removed. */
export async function isAlive(entry: RegistryEntry): Promise<boolean> {
  try {
    const res = await fetch(`${entry.origin}/api/ping?token=${entry.token}`, { signal: AbortSignal.timeout(1500) });
    if (res.ok && ((await res.json()) as { id?: string }).id === entry.id) return true;
  } catch {
    // refused / timed out
  }
  removeEntry(entry.file);
  return false;
}
