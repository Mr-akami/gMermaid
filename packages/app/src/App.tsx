import { useState } from "react";
import { ClassEditor } from "./ClassEditor";
import { FlowchartEditor } from "./FlowchartEditor";
import { SequenceEditor } from "./SequenceEditor";

type Kind = "flowchart" | "sequence" | "class";

// Both editors stay mounted so switching tabs never loses their histories.
export function App() {
  const [kind, setKind] = useState<Kind>("flowchart");

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
      </div>
      <div className={kind === "flowchart" ? "editor" : "editor hidden"}>
        <FlowchartEditor />
      </div>
      <div className={kind === "sequence" ? "editor" : "editor hidden"}>
        <SequenceEditor />
      </div>
      <div className={kind === "class" ? "editor" : "editor hidden"}>
        <ClassEditor />
      </div>
    </div>
  );
}
