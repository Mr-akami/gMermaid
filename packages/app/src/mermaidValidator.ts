import { useEffect, useRef, useState } from "react";

/** What the REAL mermaid parser thinks of some text.
 *
 * "pending" and "unavailable" are deliberately not "ok": nobody judged the
 * text, so callers must not report it as mermaid-approved. */
export type MermaidVerdict =
  | { readonly status: "pending" }
  | { readonly status: "ok" }
  | { readonly status: "rejected"; readonly message: string }
  | { readonly status: "unavailable" };

/** mermaid could not be loaded/initialized at all — not a verdict on the text. */
export class MermaidUnavailableError extends Error {
  constructor(cause: unknown) {
    super("mermaid could not be loaded", { cause });
    this.name = "MermaidUnavailableError";
  }
}

const DEBOUNCE_MS = 300;
const MAX_MESSAGE = 240;

type Mermaid = typeof import("mermaid").default;

// One instance for the whole session: mermaid.initialize() is global state and
// the module is big, so it is imported lazily (never on the first-paint path)
// and kept.
let loading: Promise<Mermaid> | undefined;

function loadMermaid(): Promise<Mermaid> {
  loading ??= import("mermaid")
    .then((m) => {
      m.default.initialize({ startOnLoad: false });
      return m.default;
    })
    .catch((cause: unknown) => {
      loading = undefined; // a failed load (offline chunk fetch) may succeed later
      throw new MermaidUnavailableError(cause);
    });
  return loading;
}

/** mermaid's parse errors are multi-line with caret art; the pane has one row. */
function shorten(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const text = raw
    .split("\n")
    .filter((line) => line.trim() !== "" && !/^-*\^$/.test(line.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}…` : text;
}

/** Run the real mermaid parser over `text`.
 *
 * Resolves to `undefined` when mermaid accepts the text, or to a short message
 * when it rejects it. Rejects with {@link MermaidUnavailableError} when mermaid
 * itself could not be loaded — that is "not validated", not "invalid". */
export async function validateWithMermaid(text: string): Promise<string | undefined> {
  const mermaid = await loadMermaid();
  try {
    await mermaid.parse(text);
    return undefined;
  } catch (cause) {
    // anything thrown by parse() is mermaid refusing the text (syntax error,
    // unknown diagram type …) — that is a verdict, not a validator failure
    return shorten(cause);
  }
}

export interface MermaidValidatorOptions {
  readonly debounceMs?: number;
  /** Seam for tests; defaults to the real mermaid parser. */
  readonly validate?: (text: string) => Promise<string | undefined>;
}

export interface MermaidValidator {
  /** Ask for a verdict on `text`. Cheap to call on every keystroke. */
  check(text: string): void;
  dispose(): void;
}

/** Debounced, newest-wins wrapper around {@link validateWithMermaid}.
 *
 * Only the newest requested text may write a verdict: a slow run for text the
 * user has already moved past is dropped, or a fast typist gets a stale error
 * pinned to code that no longer exists. */
export function createMermaidValidator(
  onVerdict: (verdict: MermaidVerdict) => void,
  options: MermaidValidatorOptions = {},
): MermaidValidator {
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const validate = options.validate ?? validateWithMermaid;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  let requested: string | undefined;
  let disposed = false;

  function settle(mine: number, verdict: MermaidVerdict): void {
    if (disposed || mine !== seq) return;
    onVerdict(verdict);
  }

  return {
    check(text) {
      if (disposed || text === requested) return;
      requested = text;
      const mine = ++seq;
      if (timer !== undefined) clearTimeout(timer);
      // clear any verdict about the previous text immediately: a rejection
      // left standing over text the user just fixed reads as a live error
      onVerdict({ status: "pending" });
      timer = setTimeout(() => {
        timer = undefined;
        validate(text).then(
          (message) => settle(mine, message === undefined ? { status: "ok" } : { status: "rejected", message }),
          // a broken validator must never block editing
          () => settle(mine, { status: "unavailable" }),
        );
      }, debounceMs);
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

/** Mermaid's verdict on `text`, kept up to date as `text` changes. */
/** `text` is undefined for a pane whose contents are not mermaid at all; it
 * then reports `unavailable`, which counts as valid and displays nothing. */
export function useMermaidVerdict(text: string | undefined, options?: MermaidValidatorOptions): MermaidVerdict {
  const [verdict, setVerdict] = useState<MermaidVerdict>({ status: "pending" });
  const validator = useRef<MermaidValidator | undefined>(undefined);
  const latestOptions = useRef(options);
  latestOptions.current = options;

  useEffect(() => {
    const v = createMermaidValidator(setVerdict, latestOptions.current ?? {});
    validator.current = v;
    return () => {
      v.dispose();
      validator.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (text === undefined) {
      setVerdict({ status: "unavailable" });
      return;
    }
    validator.current?.check(text);
  }, [text]);

  return verdict;
}
