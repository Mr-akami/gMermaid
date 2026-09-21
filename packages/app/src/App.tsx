import { useState } from "react";
import { DIAGRAMS, type DiagramKind, type LoadRequest } from "./diagrams";
import { FilesPanel } from "./FilesPanel";
import { DOC_PREFIX } from "./persistence";

export type { LoadRequest };

// All editors stay mounted so switching tabs never loses their histories.
export function App() {
  const [kind, setKind] = useState<DiagramKind>("flowchart");
  const [filesOpen, setFilesOpen] = useState(false);
  const [loads, setLoads] = useState<Partial<Record<DiagramKind, LoadRequest>>>({});

  function requestLoad(target: DiagramKind, code: string | null) {
    setLoads((s) => ({ ...s, [target]: { seq: (s[target]?.seq ?? 0) + 1, code } }));
    setKind(target);
  }

  return (
    <div className="app">
      <div className="tabs">
        {DIAGRAMS.map((d) => (
          <button key={d.kind} className={kind === d.kind ? "tab active" : "tab"} onClick={() => setKind(d.kind)}>
            {d.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button className="tab" onClick={() => setFilesOpen(true)}>
          Files
        </button>
      </div>
      {DIAGRAMS.map((d) => (
        <div key={d.kind} className={kind === d.kind ? "editor" : "editor hidden"}>
          <d.Editor loadRequest={loads[d.kind]} />
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
