import { useState } from "react";
import { DIAGRAMS, type DiagramKind, type LoadRequest } from "./diagrams";
import { AppBarContext } from "./EditorToolbar";
import { FilesPanel } from "./FilesPanel";
import { Icon } from "./icons";
import { DOC_PREFIX } from "./persistence";

export type { LoadRequest };

// All editors stay mounted so switching tabs never loses their histories.
export function App() {
  const [kind, setKind] = useState<DiagramKind>("flowchart");
  const [filesOpen, setFilesOpen] = useState(false);
  const [loads, setLoads] = useState<Partial<Record<DiagramKind, LoadRequest>>>({});
  // the visible editor portals its Open/Save and Undo/Redo into these
  const [fileSlot, setFileSlot] = useState<HTMLElement | null>(null);
  const [historySlot, setHistorySlot] = useState<HTMLElement | null>(null);

  function requestLoad(target: DiagramKind, code: string | null) {
    setLoads((s) => ({ ...s, [target]: { seq: (s[target]?.seq ?? 0) + 1, code } }));
    setKind(target);
  }

  return (
    <div className="app">
      <header className="appbar">
        <span className="brand">gMermaid</span>
        <nav className="kind-tabs" aria-label="Diagram kind">
          {DIAGRAMS.map((d) => (
            <button
              key={d.kind}
              className="kind-tab"
              aria-current={kind === d.kind ? "page" : undefined}
              onClick={() => setKind(d.kind)}
            >
              {d.label}
            </button>
          ))}
        </nav>
        <div className="appbar-actions">
          <div className="tool-group" ref={setFileSlot} />
          <button className="btn" onClick={() => setFilesOpen(true)} aria-label="Files" title="Diagrams kept in this browser">
            <Icon name="files" />
            <span className="btn-label">Files</span>
          </button>
          <div className="tool-group" ref={setHistorySlot} />
        </div>
      </header>
      {DIAGRAMS.map((d) => (
        <div key={d.kind} className={kind === d.kind ? "editor" : "editor hidden"}>
          <AppBarContext.Provider value={{ file: fileSlot, history: historySlot, active: kind === d.kind }}>
            <d.Editor loadRequest={loads[d.kind]} />
          </AppBarContext.Provider>
        </div>
      ))}
      {filesOpen && (
        <FilesPanel
          onClose={() => setFilesOpen(false)}
          onLoad={(entry) => {
            if (entry.kind === "unknown") return;
            requestLoad(entry.kind, entry.code);
            setFilesOpen(false);
          }}
          onDeleted={(entry) => {
            // deleting an autosave also resets its editor, otherwise the
            // in-memory diagram would just re-save itself unchanged
            if (entry.kind !== "unknown" && entry.key === `${DOC_PREFIX}${entry.kind}`) {
              requestLoad(entry.kind, null);
            }
          }}
        />
      )}
    </div>
  );
}
