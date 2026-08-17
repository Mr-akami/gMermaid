import { useCallback, useState } from "react";
import { ClassEditor } from "./ClassEditor";
import { FlowchartEditor } from "./FlowchartEditor";
import { SequenceEditor } from "./SequenceEditor";
import { StateEditor } from "./StateEditor";

export type DiagramKind = "flowchart" | "sequence" | "class" | "state";

export interface ReviewAppProps {
  readonly sessionId: string;
  readonly kind: DiagramKind;
  readonly mermaid: string;
  readonly title?: string | undefined;
  readonly onSubmit: (mermaid: string) => Promise<void>;
}

export function ReviewApp({ sessionId, kind, mermaid, title, onSubmit }: ReviewAppProps) {
  const [code, setCode] = useState(mermaid);
  const [valid, setValid] = useState(true);
  const [state, setState] = useState<"editing" | "submitting" | "confirmed" | "error">("editing");
  const [error, setError] = useState<string | undefined>(undefined);
  const handleCodeChange = useCallback((next: string) => setCode(next), []);
  const handleValidityChange = useCallback((next: boolean) => setValid(next), []);

  async function submit() {
    if (!valid || state === "submitting" || state === "confirmed") return;
    setState("submitting");
    setError(undefined);
    try {
      await onSubmit(code);
      setState("confirmed");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setState("error");
    }
  }

  const editorProps = {
    initialCode: mermaid,
    mode: "review" as const,
    onCodeChange: handleCodeChange,
    onValidityChange: handleValidityChange,
  };

  return (
    <main className="review-app" data-session-id={sessionId}>
      <header className="review-header">
        <div>
          <strong>{title ?? "Mermaid review"}</strong>
          <span className="hint"> {kind}</span>
        </div>
        <div className="review-actions">
          {!valid && <span className="review-error">構文エラーを修正してください</span>}
          {error !== undefined && <span className="review-error">{error}</span>}
          {state === "confirmed" ? (
            <span className="review-confirmed">LLM に返しました。チャットへ戻ってください。</span>
          ) : (
            <button disabled={!valid || state === "submitting"} onClick={submit}>
              {state === "submitting" ? "送信中…" : "LLMへ返す"}
            </button>
          )}
        </div>
      </header>
      <section className="review-editor">
        {kind === "flowchart" && <FlowchartEditor {...editorProps} />}
        {kind === "sequence" && <SequenceEditor {...editorProps} />}
        {kind === "class" && <ClassEditor {...editorProps} />}
        {kind === "state" && <StateEditor {...editorProps} />}
      </section>
    </main>
  );
}
