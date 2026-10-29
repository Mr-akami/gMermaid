import { useCallback, useEffect, useRef, useState } from "react";
import { DIAGRAMS, type DiagramKind } from "./diagrams";

// The editor for a file an agent shared with `gmermaid open`. The file is the
// master copy: what arrives here is the file as it stands (on open, and every
// time the agent rewrites it), and every edit made here is saved back into
// it. "Agent に返す" is the one explicit step — it tells the waiting agent the
// person is done for now, with an optional comment on what to reconsider.

export interface FileSnapshot {
  readonly text: string;
  readonly kind?: DiagramKind | undefined;
  readonly error?: string | undefined;
}

export interface FileSessionApi {
  /** Snapshots of the file: the first on connect, then on every outside
   * change. Returns an unsubscribe. `onLost` fires when the session ends. */
  subscribe(onFile: (s: FileSnapshot) => void, onLost: () => void): () => void;
  /** Resolves true when the file was written, false when the text was the
   * file's own (the editor echoing what it just loaded). */
  save(mermaid: string): Promise<boolean>;
  handBack(mermaid: string, comment: string): Promise<{ round: number }>;
}

export interface FileSessionAppProps {
  readonly file: string;
  readonly title?: string | undefined;
  readonly api: FileSessionApi;
}

type SaveState = "idle" | "saved" | "error";

const SAVE_DELAY_MS = 400;

export function FileSessionApp({ file, title, api }: FileSessionAppProps) {
  // the editor is keyed by kind: the agent may rewrite the file as another
  // kind of diagram, which needs another editor, not a load into this one
  const [doc, setDoc] = useState<{ kind: DiagramKind; initial: string } | undefined>(undefined);
  const [load, setLoad] = useState<{ seq: number; code: string } | undefined>(undefined);
  const [fileError, setFileError] = useState<string | undefined>(undefined);
  const [agentUpdated, setAgentUpdated] = useState(false);
  const [lost, setLost] = useState(false);
  const [valid, setValid] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [comment, setComment] = useState("");
  const [returning, setReturning] = useState(false);
  const [returned, setReturned] = useState<number | undefined>(undefined);

  const code = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const first = useRef(true);
  const kindRef = useRef<DiagramKind | undefined>(undefined);

  useEffect(
    () =>
      api.subscribe(
        (snap) => {
          if (snap.error !== undefined || snap.kind === undefined) {
            setFileError(snap.error ?? "unknown diagram kind");
            return;
          }
          setFileError(undefined);
          if (!first.current) setAgentUpdated(true);
          first.current = false;
          // an outside change wins over an edit still waiting to be saved
          clearTimeout(timer.current);
          if (snap.kind !== kindRef.current) {
            kindRef.current = snap.kind;
            setDoc({ kind: snap.kind, initial: snap.text });
            setLoad(undefined);
          } else {
            setLoad((l) => ({ seq: (l?.seq ?? 0) + 1, code: snap.text }));
          }
        },
        () => setLost(true),
      ),
    [api],
  );

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (code.current === undefined) return;
    try {
      if (await api.save(code.current)) {
        setSaveState("saved");
        setAgentUpdated(false);
      }
      setSaveError(undefined);
    } catch (cause) {
      setSaveState("error");
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [api]);

  const handleCode = useCallback(
    (next: string) => {
      code.current = next;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  async function handBack() {
    if (code.current === undefined || !valid || returning) return;
    setReturning(true);
    setSaveError(undefined);
    try {
      clearTimeout(timer.current);
      const { round } = await api.handBack(code.current, comment);
      setReturned(round);
      setComment("");
      setAgentUpdated(false);
      setSaveState("saved");
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setReturning(false);
    }
  }

  const def = doc === undefined ? undefined : DIAGRAMS.find((d) => d.kind === doc.kind);
  const status = lost
    ? "セッションは終了しました"
    : saveState === "error"
        ? "保存できません"
        : agentUpdated
          ? "Agent がファイルを更新しました"
          : returned !== undefined
            ? `Agent に返しました（${returned} 回目）`
            : saveState === "saved"
              ? "ファイルに保存しました"
              : "編集はファイルに自動保存されます";

  return (
    <main className="review-app file-session">
      <header className="review-header">
        <div className="session-id">
          <strong>{title ?? "gMermaid"}</strong>
          <code className="session-file">{file}</code>
          <span className={agentUpdated || lost || saveState === "error" ? "session-status attention" : "session-status"} role="status">
            {status}
          </span>
        </div>
        <form
          className="review-actions"
          onSubmit={(e) => {
            e.preventDefault();
            void handBack();
          }}
        >
          {!valid && <span className="review-error">構文エラーを修正してください</span>}
          {saveError !== undefined && <span className="review-error">{saveError}</span>}
          <input
            className="handback-comment"
            aria-label="Agent へのコメント"
            placeholder="Agent へのコメント（任意）"
            value={comment}
            disabled={lost}
            onChange={(e) => setComment(e.target.value)}
          />
          <button type="submit" className="primary" disabled={lost || !valid || returning || doc === undefined}>
            {returning ? "送信中…" : "Agent に返す"}
          </button>
        </form>
      </header>
      {fileError !== undefined && (
        <div className="code-banner" role="alert">
          ファイルを図として開けません。Agent の修正を待っています：{fileError}
        </div>
      )}
      <section className="review-editor">
        {doc !== undefined && def !== undefined && (
          <def.Editor
            key={doc.kind}
            initialCode={doc.initial}
            mode="review"
            loadRequest={load}
            onCodeChange={handleCode}
            onValidityChange={setValid}
          />
        )}
      </section>
    </main>
  );
}
