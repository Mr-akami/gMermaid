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

/** Restore a diagram from localStorage, or fall back to a sample. */
export function loadInitial<T>(storageKey: string, parse: (code: string) => ParseResult<T>, sample: () => T): T {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored !== null) {
      const result = parse(stored);
      if (result.ok) return result.ir;
    }
  } catch {
    // storage unavailable (private mode etc.) — just start from the sample
  }
  return sample();
}

/** Mirror the canonical code to localStorage whenever the IR changes. */
export function useAutosave(storageKey: string, code: string): void {
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, code);
    } catch {
      // best effort only
    }
  }, [storageKey, code]);
}
