import { useEffect, useSyncExternalStore } from "react";

// One switch for every editor: the code pane is a view preference, not
// document state. Mirrored onto <html data-code-closed> so the grid (CSS)
// collapses the column while the panes stay MOUNTED — a half-typed draft
// lives in their React state.
const KEY = "gmermaid.codePaneOpen";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored !== null) return stored !== "0";
  } catch {
    /* no stored preference */
  }
  // narrow screens show the pane as a drawer over the canvas: closed until asked for
  return !(typeof window !== "undefined" && window.matchMedia?.("(max-width: 900px)").matches);
}

let open = read();

function apply(): void {
  if (typeof document === "undefined") return;
  if (open) delete document.documentElement.dataset["codeClosed"];
  else document.documentElement.dataset["codeClosed"] = "";
}
apply();

export function setCodePaneOpen(next: boolean): void {
  open = next;
  try {
    localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    /* view preference only */
  }
  apply();
  listeners.forEach((l) => l());
}

export function useCodePaneOpen(): readonly [boolean, (next: boolean) => void] {
  const v = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
    () => true,
  );
  return [v, setCodePaneOpen];
}

// Width: dragged on the pane's left edge, kept as --code-w on <html>.
const W_KEY = "gmermaid.codePaneWidth";
export const CODE_W_MIN = 240;
export const CODE_W_MAX = 900;

export function setCodePaneWidth(px: number): void {
  const w = Math.round(Math.min(CODE_W_MAX, Math.max(CODE_W_MIN, px)));
  document.documentElement.style.setProperty("--code-w", `${w}px`);
  try {
    localStorage.setItem(W_KEY, String(w));
  } catch {
    /* view preference only */
  }
}

if (typeof document !== "undefined") {
  try {
    const saved = Number(localStorage.getItem(W_KEY));
    if (Number.isFinite(saved) && saved > 0) setCodePaneWidth(saved);
  } catch {
    /* default width */
  }
}

/** Ctrl/Cmd+\ toggles the pane; mounted by every toolbar, harmless twice
 * only because the hidden editors' toolbars are the same listener target —
 * so the caller passes `active`. */
export function useCodePaneShortcut(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
        e.preventDefault();
        setCodePaneOpen(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}
