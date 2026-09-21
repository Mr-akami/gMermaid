import { useCallback, useEffect, useRef, useState } from "react";
import CodeMirror, { ExternalChange } from "@uiw/react-codemirror";
import type { ViewUpdate } from "@codemirror/view";
import type { ParseError, ParseResult, ParseWarning } from "@gmermaid/mermaid-parser";
import { useMermaidVerdict } from "./mermaidValidator";

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
  /** Reports the REAL mermaid parser's verdict on the shown text: false only
   * when mermaid refused it outright.
   *
   * Kept apart from {@link onValidityChange} on purpose. Text our own parser
   * accepts is already in the IR — real user work — and must keep being
   * persisted even while mermaid cannot read the generated text (whole
   * diagram families have had such codegen bugs). So autosave follows
   * `onValidityChange`, and only the MCP review submit follows this one. */
  readonly onMermaidValidityChange?: ((valid: boolean) => void) | undefined;
  /** False for a pane whose text is not mermaid at all (the XState tab):
   * mermaid.js would reject it every keystroke and the message would be a
   * lie. Such a pane reports itself mermaid-valid and shows nothing. */
  readonly mermaidText?: boolean | undefined;
  /** What the LAST load (file, Files panel, autosave) threw away. Shown until
   * the user starts editing, at which point their own draft speaks instead. */
  readonly loadWarnings?: readonly ParseWarning[] | undefined;
  /** What THIS projection cannot say about the current IR — produced by
   * codegen, not by a parse, so it has no line to point at. Only shown while
   * the pane mirrors the canonical code: once the user has a draft, the text
   * on screen is theirs and the canonical losses are not about it. */
  readonly codeWarnings?: readonly string[] | undefined;
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
  onMermaidValidityChange,
  mermaidText = true,
  loadWarnings,
  codeWarnings,
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
  // Dropped statements (styling, accessibility …) are informational: they
  // never block a commit and never make the draft invalid — but the user has
  // to be told, or the save silently eats them.
  const [warnings, setWarnings] = useState<readonly ParseWarning[]>([]);
  const active = draft !== null && (focused || draft.base === code) ? draft : null;
  // The focused-draft display bypasses the base check (no reformatting under
  // the cursor), so an IR change that arrives WITHOUT stealing focus (e.g. a
  // keyboard shortcut or future collaborative edit) would leave a stale
  // draft silently shadowing the newer diagram. Surface it and let the user
  // choose instead of losing either side.
  const staleWhileFocused = focused && draft !== null && draft.base !== code;

  // CONTEXT.md's Validation rule: the real mermaid parser judges the text, not
  // just our own. Judging what the pane SHOWS covers both directions with one
  // mechanism — a hand-typed diagram we accept but mermaid does not, and code
  // our codegen produced that mermaid cannot read.
  const shownCode = active?.text ?? code;
  const mermaidVerdict = useMermaidVerdict(mermaidText ? shownCode : undefined);

  const valid = errors.length === 0 && !staleWhileFocused;
  // "pending"/"unavailable" deliberately count as valid: validation is async
  // and may never answer (offline chunk), and a permanently disabled review
  // button would be worse than a late error.
  const mermaidValid = mermaidVerdict.status !== "rejected";
  // What the last successful parse dropped. It outlives the draft on
  // purpose: by the time the pane snaps back to canonical code the styling is
  // ALREADY gone from it, which is exactly when the user needs to be told.
  // Starting a new draft (onFocus) clears it.
  const shownWarnings = warnings.length > 0 ? warnings : draft === null ? (loadWarnings ?? []) : [];
  const validityRef = useRef(onValidityChange);
  validityRef.current = onValidityChange;
  useEffect(() => validityRef.current?.(valid), [valid]);
  const mermaidValidityRef = useRef(onMermaidValidityChange);
  mermaidValidityRef.current = onMermaidValidityChange;
  useEffect(() => mermaidValidityRef.current?.(mermaidValid), [mermaidValid]);

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
      setWarnings(result.warnings);
      latest.current.onCommit(result.ir);
    } else {
      setErrors(result.errors);
    }
  }, []);

  function discardDraft() {
    setDraft(null);
    setErrors([]);
    setWarnings([]);
  }

  function overwriteWithDraft() {
    if (draft === null) return;
    setDraft({ text: draft.text, base: code });
    const result = parse(draft.text);
    if (result.ok) {
      setErrors([]);
      setWarnings(result.warnings);
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
            setWarnings([]);
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
      {mermaidVerdict.status === "rejected" && (
        <div className="code-mermaid-error">
          <strong>Mermaid.js が解釈できません:</strong> {mermaidVerdict.message}
        </div>
      )}
      {(shownWarnings.length > 0 || (active === null && (codeWarnings?.length ?? 0) > 0)) && (
        <div className="code-warnings">
          {shownWarnings.map((w, i) => (
            <div key={i}>
              line {w.line}: {w.message}
            </div>
          ))}
          {active === null && codeWarnings?.map((w, i) => <div key={`c${i}`}>{w}</div>)}
        </div>
      )}
    </div>
  );
}
