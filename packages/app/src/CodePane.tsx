import { useCallback, useEffect, useRef, useState } from "react";
import CodeMirror, { ExternalChange } from "@uiw/react-codemirror";
import type { ViewUpdate } from "@codemirror/view";
import type { ParseError, ParseResult } from "@gmermaid/mermaid-parser";

export interface CodePaneProps<T> {
  /** Canonical code generated from the IR. */
  readonly code: string;
  readonly parse: (code: string) => ParseResult<T>;
  readonly onCommit: (ir: T) => void;
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
  /** Recovered (unparseable) text to open as a broken draft, e.g. stored
   * data that stopped parsing after a grammar change (S1-3). */
  readonly initialDraft?: string | undefined;
  /** Reports whether the visible draft can be represented by the canonical IR. */
  readonly onValidityChange?: ((valid: boolean) => void) | undefined;
}

// While focused the pane always shows its own draft (never reformatted
// under the user's cursor); valid drafts commit to the IR on every change,
// invalid ones only show errors. A draft left behind on blur (still broken)
// remembers which canonical code it branched from: if the IR moves
// underneath (canvas edit), the stale draft self-invalidates rather than
// silently overwriting the newer diagram when it is finally fixed.
interface Draft {
  readonly text: string;
  readonly base: string;
}

export function CodePane<T>({
  code,
  parse,
  onCommit,
  onEditStart,
  onEditEnd,
  initialDraft,
  onValidityChange,
}: CodePaneProps<T>) {
  const [draft, setDraft] = useState<Draft | null>(() =>
    initialDraft !== undefined ? { text: initialDraft, base: code } : null,
  );
  const [focused, setFocused] = useState(false);
  const [errors, setErrors] = useState<readonly ParseError[]>(() => {
    if (initialDraft === undefined) return [];
    const r = parse(initialDraft);
    return r.ok ? [] : r.errors;
  });
  const active = draft !== null && (focused || draft.base === code) ? draft : null;
  // The focused-draft display bypasses the base check (no reformatting under
  // the cursor), so an IR change that arrives WITHOUT stealing focus (e.g. a
  // keyboard shortcut or future collaborative edit) would leave a stale
  // draft silently shadowing the newer diagram. Surface it and let the user
  // choose instead of losing either side.
  const staleWhileFocused = focused && draft !== null && draft.base !== code;

  const valid = errors.length === 0 && !staleWhileFocused;
  const validityRef = useRef(onValidityChange);
  validityRef.current = onValidityChange;
  useEffect(() => validityRef.current?.(valid), [valid]);

  // latest-ref: keeps handleChange referentially stable so the CodeMirror
  // wrapper doesn't reconfigure its extensions on every parent render
  const latest = useRef({ code, parse, onCommit });
  latest.current = { code, parse, onCommit };

  const handleChange = useCallback((value: string, viewUpdate: ViewUpdate) => {
    // Reject only KNOWN-external transactions (our own value-prop syncs,
    // tagged by the wrapper with ExternalChange). Filtering the other way
    // round ("accept only userEvent") would silently drop user edits from
    // any extension that forgets the annotation.
    const isExternal = viewUpdate.transactions.some((tr) => tr.annotation(ExternalChange) !== undefined);
    if (isExternal) return;
    setDraft({ text: value, base: latest.current.code });
    const result = latest.current.parse(value);
    if (result.ok) {
      setErrors([]);
      latest.current.onCommit(result.ir);
    } else {
      setErrors(result.errors);
    }
  }, []);

  function discardDraft() {
    setDraft(null);
    setErrors([]);
  }

  function overwriteWithDraft() {
    if (draft === null) return;
    setDraft({ text: draft.text, base: code });
    const result = parse(draft.text);
    if (result.ok) {
      setErrors([]);
      onCommit(result.ir);
    } else {
      setErrors(result.errors);
    }
  }

  return (
    <div className="code-pane">
      {staleWhileFocused && (
        <div className="code-banner">
          図が変更されました。
          <button onClick={discardDraft}>破棄</button>
          <button onClick={overwriteWithDraft}>このコードで上書き</button>
        </div>
      )}
      <CodeMirror
        value={active?.text ?? code}
        height="100%"
        style={{ flex: 1, overflow: "auto" }}
        onChange={handleChange}
        onFocus={() => {
          setFocused(true);
          onEditStart();
          if (draft === null || draft.base !== code) {
            setErrors([]); // a rebuilt draft starts from valid canonical code
            setDraft({ text: code, base: code });
          }
        }}
        onBlur={() => {
          setFocused(false);
          onEditEnd();
          // valid drafts are already committed — drop them and mirror the
          // canonical code again; broken drafts stay, pinned to their base
          setDraft((d) => (errors.length === 0 ? null : d && { text: d.text, base: code }));
        }}
      />
      {active !== null && errors.length > 0 && (
        <div className="code-errors">
          {errors.map((e, i) => (
            <div key={i}>
              line {e.line}: {e.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
