import { useState } from "react";
import { ClassEditor } from "./ClassEditor";
import { FilesPanel } from "./FilesPanel";
import { FlowchartEditor } from "./FlowchartEditor";
import { SequenceEditor } from "./SequenceEditor";
import { StateEditor } from "./StateEditor";
import { DOC_PREFIX } from "./persistence";

type Kind = "flowchart" | "sequence" | "class" | "state";

/** A request for an editor to replace its diagram: code, or null = sample. */
export interface LoadRequest {
  readonly seq: number;
  readonly code: string | null;
}

// Both editors stay mounted so switching tabs never loses their histories.
export function App() {
  const [kind, setKind] = useState<Kind>("flowchart");
  const [filesOpen, setFilesOpen] = useState(false);
  const [loads, setLoads] = useState<Partial<Record<Kind, LoadRequest>>>({});

  function requestLoad(target: Kind, code: string | null) {
    setLoads((s) => ({ ...s, [target]: { seq: (s[target]?.seq ?? 0) + 1, code } }));
    setKind(target);
  }

  return (
    <div className="app">
      <div className="tabs">
        <button className={kind === "flowchart" ? "tab active" : "tab"} onClick={() => setKind("flowchart")}>
          Flowchart
        </button>
        <button className={kind === "sequence" ? "tab active" : "tab"} onClick={() => setKind("sequence")}>
          Sequence
        </button>
        <button className={kind === "class" ? "tab active" : "tab"} onClick={() => setKind("class")}>
          Class
        </button>
        <button className={kind === "state" ? "tab active" : "tab"} onClick={() => setKind("state")}>
          State
        </button>
        <span style={{ flex: 1 }} />
        <button className="tab" onClick={() => setFilesOpen(true)}>
          Files
        </button>
      </div>
      <div className={kind === "flowchart" ? "editor" : "editor hidden"}>
        <FlowchartEditor loadRequest={loads.flowchart} />
      </div>
      <div className={kind === "sequence" ? "editor" : "editor hidden"}>
        <SequenceEditor loadRequest={loads.sequence} />
      </div>
      <div className={kind === "class" ? "editor" : "editor hidden"}>
        <ClassEditor loadRequest={loads.class} />
      </div>
      <div className={kind === "state" ? "editor" : "editor hidden"}>
        <StateEditor loadRequest={loads.state} />
      </div>
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
