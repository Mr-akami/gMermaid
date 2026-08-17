import { useEffect, useMemo, useState } from "react";
import {
  applyFlowchartAction,
  emptyFlowchart,
  newId,
  type FlowchartIR,
  type NodeId,
} from "@gmermaid/ir";
import { layoutFlowchart } from "@gmermaid/layout";
import { flowchartToMermaid } from "@gmermaid/mermaid-codegen";
import { parseFlowchart } from "@gmermaid/mermaid-parser";
import { FlowchartView } from "@gmermaid/renderer";
import { measurer } from "./measurer";
import { formatParseErrors, loadInitial, openMmd, saveMmd, useAutosave } from "./persistence";
import { CodePane } from "./CodePane";
import { ErrorBoundary } from "./ErrorBoundary";
import { PropertyWindow } from "./PropertyWindow";
import { useDiagramHistory } from "./useDiagramHistory";

function initialIR(): FlowchartIR {
  let ir = emptyFlowchart("TB");
  const a = newId("node");
  const b = newId("node");
  ir = applyFlowchartAction(ir, { type: "addNode", node: { id: a, label: "Start", shape: "rounded" } });
  ir = applyFlowchartAction(ir, { type: "addNode", node: { id: b, label: "End", shape: "rounded" } });
  ir = applyFlowchartAction(ir, { type: "addEdge", id: newId("edge"), from: a, to: b });
  return ir;
}

// ViewState: transient UI state, never part of the IR (ADR 0001).
interface ViewState {
  readonly selectedId?: string;
  readonly connectFrom?: NodeId;
}

const STORAGE_KEY = "gmermaid:flowchart";

export interface EditorProps {
  /** External replace request from the Files panel (null code = sample). */
  readonly loadRequest?: { readonly seq: number; readonly code: string | null } | undefined;
}

export function FlowchartEditor({ loadRequest }: EditorProps) {
  const h = useDiagramHistory(() => loadInitial(STORAGE_KEY, parseFlowchart, initialIR), applyFlowchartAction);
  const [view, setView] = useState<ViewState>({});
  // drag-to-connect rubber band: view-transient (ADR 0001)
  const [connectLine, setConnectLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | undefined>(undefined);
  const ir = h.ir;

  // The pipeline, spelled out: IR → layout → code. render happens below in JSX.
  const layout = useMemo(() => layoutFlowchart(ir, measurer), [ir]);
  const code = useMemo(() => flowchartToMermaid(ir), [ir]);
  useAutosave(STORAGE_KEY, code);

  useEffect(() => {
    if (!loadRequest) return;
    if (loadRequest.code === null) {
      h.pushIR(initialIR());
    } else {
      const result = parseFlowchart(loadRequest.code);
      if (result.ok) h.pushIR(result.ir);
      else alert(`Cannot load stored diagram:\n${formatParseErrors(result.errors)}`);
    }
    setView({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRequest?.seq]);

  async function openFile() {
    const text = await openMmd();
    if (text === null) return;
    const result = parseFlowchart(text);
    if (result.ok) {
      h.pushIR(result.ir);
      setView({});
    } else {
      alert(`Cannot open file:\n${result.errors.map((e) => `line ${e.line}: ${e.message}`).join("\n")}`);
    }
  }

  function addNode() {
    const id = newId("node");
    h.dispatch({ type: "addNode", node: { id, label: "Node", shape: "rect" } });
    setView({ selectedId: id });
  }

  const selectedNode = ir.nodes.find((n) => n.id === view.selectedId);
  const selectedEdge = ir.edges.find((e) => e.id === view.selectedId);
  const selected = selectedNode ?? selectedEdge;

  function handleConnectDrag(fromId: string, x: number, y: number) {
    const from = layout.nodes.find((n) => n.id === fromId);
    if (from) setConnectLine({ x1: from.rect.x + from.rect.w / 2, y1: from.rect.y + from.rect.h / 2, x2: x, y2: y });
  }

  function handleConnectDrop(fromId: string, x: number, y: number) {
    setConnectLine(undefined);
    const from = ir.nodes.find((n) => n.id === fromId);
    const target = layout.nodes.find(
      (n) => n.id !== fromId && x >= n.rect.x && x <= n.rect.x + n.rect.w && y >= n.rect.y && y <= n.rect.y + n.rect.h,
    );
    if (!from || !target) return;
    const edgeId = newId("edge");
    h.dispatch({ type: "addEdge", id: edgeId, from: from.id, to: target.id });
    setView({ selectedId: edgeId });
  }

  function handleElementClick(id: string) {
    const targetNode = ir.nodes.find((n) => n.id === id);
    if (view.connectFrom !== undefined && targetNode) {
      h.dispatch({ type: "addEdge", id: newId("edge"), from: view.connectFrom, to: targetNode.id });
    }
    setView({ selectedId: id });
  }

  return (
    <>
      <div className="toolbar">
        <button onClick={openFile}>Open…</button>
        <button onClick={() => saveMmd(code, "flowchart.mmd")}>Save…</button>
        <button onClick={addNode}>+ Node</button>
        <button
          disabled={selectedNode === undefined}
          onClick={() => selectedNode && setView({ ...view, connectFrom: selectedNode.id })}
        >
          → Connect from selected
        </button>
        <button onClick={h.undo} disabled={!h.canUndo}>Undo</button>
        <button onClick={h.redo} disabled={!h.canRedo}>Redo</button>
        <select
          value={ir.direction}
          onChange={(e) => h.dispatch({ type: "setDirection", direction: e.target.value as FlowchartIR["direction"] })}
        >
          <option value="TB">Top→Bottom</option>
          <option value="LR">Left→Right</option>
          <option value="BT">Bottom→Top</option>
          <option value="RL">Right→Left</option>
        </select>
        {view.connectFrom !== undefined && <span className="hint">click a target node to connect…</span>}
      </div>
      <div className="canvas">
        <ErrorBoundary>
          <FlowchartView
            layout={layout}
            viewState={{ selectedId: view.selectedId }}
            onElementClick={handleElementClick}
            onBackgroundClick={() => setView({})}
            onConnectDrag={handleConnectDrag}
            onConnectDrop={handleConnectDrop}
            connectLine={connectLine}
            onGestureCancel={() => setConnectLine(undefined)}
          />
        </ErrorBoundary>
        {selected && (
          <PropertyWindow
            element={selected}
            onChangeNodeLabel={(label) =>
              selectedNode && h.dispatch({ type: "updateNode", id: selectedNode.id, label }, `node:${selectedNode.id}:label`)
            }
            onChangeNodeShape={(shape) => selectedNode && h.dispatch({ type: "updateNode", id: selectedNode.id, shape })}
            onChangeEdgeLabel={(label) =>
              selectedEdge && h.dispatch({ type: "updateEdge", id: selectedEdge.id, label }, `edge:${selectedEdge.id}:label`)
            }
            onChangeEdgeArrow={(arrow) => selectedEdge && h.dispatch({ type: "updateEdge", id: selectedEdge.id, arrow })}
            onDelete={() => {
              if (selectedNode) h.dispatch({ type: "removeNode", id: selectedNode.id });
              if (selectedEdge) h.dispatch({ type: "removeEdge", id: selectedEdge.id });
              setView({});
            }}
            onEditStart={() => {}}
            onEditEnd={h.endEdit}
          />
        )}
      </div>
      <CodePane
        code={code}
        parse={parseFlowchart}
        onCommit={(next) => h.pushIR(next, "code-pane")}
        onEditStart={() => {}}
        onEditEnd={h.endEdit}
      />
    </>
  );
}
