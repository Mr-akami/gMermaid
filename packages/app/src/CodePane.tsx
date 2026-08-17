import { useCallback, useRef, useState } from "react";
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

export function CodePane<T>({ code, parse, onCommit, onEditStart, onEditEnd }: CodePaneProps<T>) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [focused, setFocused] = useState(false);
  const [errors, setErrors] = useState<readonly ParseError[]>([]);
  const active = draft !== null && (focused || draft.base === code) ? draft : null;

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

  return (
    <div className="code-pane">
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
