// The editor holds every diagram to TWO parsers: gMermaid's own, which it
// opens files with, and the real mermaid.js, whose rejection disables "Send
// to agent". `validate` used to ask only the first, so a file could pass here
// and then be refused in the GUI — worst of all when it is the editor's OWN
// rewrite of the text that mermaid.js chokes on. This asks mermaid.js too,
// about both texts.
//
// mermaid.js needs a DOM, so it runs on jsdom. Both are big and only
// `validate` wants them, so they are loaded on first use and never on the
// MCP / editor paths.

type Mermaid = typeof import("mermaid").default;

let loading: Promise<Mermaid> | undefined;

/** Globals mermaid (and the DOMPurify it bundles) reach for at import time. */
const DOM_GLOBALS = ["window", "document", "navigator", "Element", "HTMLElement", "SVGElement", "Node", "DOMParser", "MutationObserver", "getComputedStyle"] as const;

async function loadMermaid(): Promise<Mermaid> {
  loading ??= (async () => {
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
    const g = globalThis as Record<string, unknown>;
    const win = dom.window as unknown as Record<string, unknown>;
    for (const key of DOM_GLOBALS) {
      if (g[key] !== undefined && key !== "window" && key !== "document") continue;
      const value = key === "window" ? dom.window : win[key];
      Object.defineProperty(g, key, { value: typeof value === "function" && key === "getComputedStyle" ? value.bind(dom.window) : value, configurable: true, writable: true });
    }
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({ startOnLoad: false });
    return mermaid;
  })();
  return loading;
}

export interface MermaidRejection {
  /** 1-based line within the checked text, when mermaid names one. */
  readonly line?: number;
  readonly message: string;
}

/** mermaid's parse errors are multi-line with caret art; one line is enough. */
function shorten(raw: string): string {
  const text = raw
    .split("\n")
    .filter((l) => l.trim() !== "" && !/^-*\^$/.test(l.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

/** mermaid.js's verdict on `text`: `undefined` when it accepts it. Throws
 * when mermaid itself cannot be loaded — that is "not checked", not "invalid". */
export async function mermaidRejects(text: string): Promise<MermaidRejection | undefined> {
  const mermaid = await loadMermaid();
  try {
    await mermaid.parse(text);
    return undefined;
  } catch (cause) {
    const raw = cause instanceof Error ? cause.message : String(cause);
    const line = /on line (\d+)/.exec(raw)?.[1];
    return line === undefined ? { message: shorten(raw) } : { line: Number(line), message: shorten(raw) };
  }
}
