import { useEffect } from "react";
import type { ParseResult } from "@gmermaid/mermaid-parser";

// .mmd open/save via the File System Access API where available (Chromium),
// falling back to download / <input type=file>. Work in progress is also
// mirrored to localStorage on every IR change.

declare global {
  interface Window {
    showSaveFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle>;
    showOpenFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle[]>;
  }
}

const MMD_TYPE = { description: "Mermaid diagram", accept: { "text/plain": [".mmd"] } };

export async function saveMmd(code: string, suggestedName: string): Promise<void> {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName, types: [MMD_TYPE] });
      const writable = await handle.createWritable();
      await writable.write(code);
      await writable.close();
      return;
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return; // user cancelled
      throw e;
    }
  }
  const url = URL.createObjectURL(new Blob([code], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
}

export async function openMmd(): Promise<string | null> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: [MMD_TYPE] });
      if (!handle) return null;
      return await (await handle.getFile()).text();
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return null;
      throw e;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".mmd,.txt";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then(resolve, () => resolve(null));
    });
    input.click();
  });
}

// Stored value format: JSON {code, updatedAt}. Legacy entries hold the raw
// code string — readStoredCode accepts both.
interface StoredValue {
  readonly code: string;
  readonly updatedAt: number;
}

export function readStoredCode(raw: string): { code: string; updatedAt: number | null } {
  try {
    const v = JSON.parse(raw) as Partial<StoredValue>;
    if (typeof v === "object" && v !== null && typeof v.code === "string") {
      return { code: v.code, updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : null };
    }
  } catch {
    // legacy: raw code string
  }
  return { code: raw, updatedAt: null };
}

/** Restore a diagram from localStorage, or fall back to a sample.
 * If the stored code no longer parses (grammar changed between versions),
 * it is MOVED to a `:broken-<timestamp>` key first — otherwise the very
 * first autosave would overwrite it with the sample and destroy the data.
 * Broken entries stay visible in the Files panel for manual recovery. */
export function loadInitial<T>(storageKey: string, parse: (code: string) => ParseResult<T>, sample: () => T): T {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored !== null) {
      const result = parse(readStoredCode(stored).code);
      if (result.ok) return result.ir;
      localStorage.setItem(`${storageKey}:broken-${Date.now()}`, stored);
      localStorage.removeItem(storageKey);
    }
  } catch {
    // storage unavailable (private mode etc.) — just start from the sample
  }
  return sample();
}

/** Mirror the canonical code to localStorage whenever the IR changes.
 * Debounced: localStorage writes are synchronous and per-keystroke saves
 * would stall the main thread on large diagrams. */
export function useAutosave(storageKey: string, code: string): void {
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ code, updatedAt: Date.now() } satisfies StoredValue));
      } catch {
        // best effort only
      }
    }, 500);
    return () => clearTimeout(t);
  }, [storageKey, code]);
}

export function formatParseErrors(errors: readonly { line: number; message: string }[]): string {
  return errors.map((e) => `line ${e.line}: ${e.message}`).join("\n");
}

export const STORAGE_PREFIX = "gmermaid:";

export interface StoredEntry {
  readonly key: string;
  readonly kind: "flowchart" | "sequence" | "class" | "unknown";
  readonly updatedAt: number | null;
  readonly bytes: number;
  readonly code: string;
}

function detectKind(code: string): StoredEntry["kind"] {
  const head = code.trimStart();
  if (head.startsWith("flowchart") || head.startsWith("graph")) return "flowchart";
  if (head.startsWith("sequenceDiagram")) return "sequence";
  if (head.startsWith("classDiagram")) return "class";
  return "unknown";
}

/** Every gMermaid entry currently in localStorage, newest first. */
export function listStoredEntries(): StoredEntry[] {
  const entries: StoredEntry[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null || !key.startsWith(STORAGE_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      const { code, updatedAt } = readStoredCode(raw);
      entries.push({ key, kind: detectKind(code), updatedAt, bytes: raw.length, code });
    }
  } catch {
    // storage unavailable
  }
  return entries.toSorted((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export function deleteStoredEntry(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // storage unavailable
  }
}
