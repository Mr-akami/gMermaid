// The system clipboard, with the honest caveats.
//
// Copy carries MERMAID TEXT, so the point is that it leaves the app: into
// the code pane, into a chat window, into anyone else's mermaid tool — and
// text written anywhere else comes back onto the canvas. That only works
// through `navigator.clipboard`, which is async, permission-gated and
// refused outright in an insecure context or a background tab.
//
// So every call keeps a copy here as well. When the browser says no, copy
// and paste still work inside the app and the user is TOLD that is what
// happened, rather than pressing Ctrl+C and watching nothing occur.

let memory: string | undefined;

export interface ClipboardWrite {
  /** False when the system clipboard refused — the text is still in memory. */
  readonly system: boolean;
}

export interface ClipboardRead {
  readonly text: string | undefined;
  /** False when the system clipboard refused and memory answered instead. */
  readonly system: boolean;
}

/** What the app last copied, whatever the system clipboard did. */
export function clipboardMemory(): string | undefined {
  return memory;
}

export async function writeClipboardText(text: string): Promise<ClipboardWrite> {
  memory = text;
  try {
    await navigator.clipboard.writeText(text);
    return { system: true };
  } catch {
    return { system: false };
  }
}

export async function readClipboardText(): Promise<ClipboardRead> {
  try {
    const text = await navigator.clipboard.readText();
    // a browser that answers with nothing has not necessarily refused, but
    // our own last copy is the better guess than pasting emptiness
    if (text !== "") return { text, system: true };
  } catch {
    // permission denied, insecure context, or the tab is not focused
  }
  return { text: memory, system: false };
}
