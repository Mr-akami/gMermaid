import { useEffect, useMemo, useState } from "react";
import {
  applyFlowchartAction,
  edgeRetargetRejection,
  emptyFlowchart,
  newId,
  type EdgeId,
  type FlowchartEndpoint,
  type FlowchartIR,
  type NodeId,
  type SubgraphId,
} from "@gmermaid/ir";
import { layoutFlowchart } from "@gmermaid/layout";
import { flowchartToMermaid } from "@gmermaid/mermaid-codegen";
import { parseFlowchart } from "@gmermaid/mermaid-parser";
import { FlowchartView } from "@gmermaid/renderer";
import { measurer } from "./measurer";
import { loadInitial, openMmd, saveMmd, useAutosave, useLoadWarnings } from "./persistence";
import { CodePane } from "./CodePane";
import { ErrorBoundary } from "./ErrorBoundary";
import { PropertyWindow } from "./PropertyWindow";
import { SelectionOverlay, SelectionTools } from "./SelectionUI";
import { useDiagramHistory } from "./useDiagramHistory";
import { useEditorShell } from "./useEditorShell";
import { withSelected } from "./viewSelection";
import type { EditorRuntimeProps } from "./editorRuntime";

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

const STORAGE_KEY = "gmermaid:doc:flowchart";

export interface EditorProps extends EditorRuntimeProps {
  /** External replace request from the Files panel (null code = sample). */
  readonly loadRequest?: { readonly seq: number; readonly code: string | null } | undefined;
}

export function FlowchartEditor({ loadRequest, initialCode, mode = "standalone", onCodeChange, onValidityChange }: EditorProps) {
  // recoveredText: stored data that stopped parsing, poured into the code
  // pane as a broken draft for manual repair (S1-3)
  const [initial] = useState(() => {
    if (initialCode === undefined) return loadInitial(STORAGE_KEY, parseFlowchart, initialIR);
    const parsed = parseFlowchart(initialCode);
    return parsed.ok ? { ir: parsed.ir, warnings: parsed.warnings } : { ir: initialIR(), recoveredText: initialCode, warnings: [] };
  });
  const load = useLoadWarnings(initial.warnings);
  const h = useDiagramHistory(() => initial.ir, applyFlowchartAction);
  const [view, setView] = useState<ViewState>({});
  // drag-to-connect rubber band: view-transient (ADR 0001)
  const [connectLine, setConnectLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | undefined>(undefined);
  const ir = h.ir;

  // The pipeline, spelled out: IR → layout → code. render happens below in JSX.
  const layout = useMemo(() => layoutFlowchart(ir, measurer), [ir]);
  const code = useMemo(() => flowchartToMermaid(ir), [ir]);
  // autosave pauses while the code pane shows a broken/stale draft, so a
  // recovered draft is never clobbered by the sample it fell back to
  const [codeValid, setCodeValid] = useState(initial.recoveredText === undefined);
  useAutosave(STORAGE_KEY, code, mode === "standalone" && codeValid);
  // autosave follows OUR parser alone: a diagram the IR already holds is real
  // work, and must keep being saved even while mermaid refuses its text.
  // Mermaid's verdict travels separately, and only gates the review submit.
  const [mermaidValid, setMermaidValid] = useState(true);
  useEffect(() => onCodeChange?.(code), [code, onCodeChange]);
  useEffect(() => onValidityChange?.(codeValid && mermaidValid), [codeValid, mermaidValid, onValidityChange]);

  useEffect(() => {
    if (!loadRequest) return;
    // a REPLACED diagram is framed afresh; an edit never moves the camera
    shell.fitOnNextLayout();
    if (loadRequest.code === null) {
      h.pushIR(initialIR());
    } else {
      const loaded = load.accept(parseFlowchart(loadRequest.code), "Cannot load stored diagram");
      if (loaded !== undefined) h.pushIR(loaded);
    }
    setView({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRequest?.seq]);

  async function openFile() {
    const text = await openMmd();
    if (text === null) return;
    const opened = load.accept(parseFlowchart(text), "Cannot open file");
    if (opened === undefined) return;
    shell.fitOnNextLayout();
    h.pushIR(opened);
    setView({});
  }

  function addNode() {
    const id = newId("node");
    // a selected subgraph adopts the new node
    const parent = selectedSubgraph?.id;
    h.dispatch({ type: "addNode", node: { id, label: "Node", shape: "rect", ...(parent !== undefined ? { parent } : {}) } });
    setView({ selectedId: id });
  }

  function addSubgraph() {
    const id = newId("subgraph");
    let n = 1;
    while (ir.subgraphs.some((s) => s.label === `Group ${n}`)) n += 1;
    h.dispatch({ type: "addSubgraph", subgraph: { id, label: `Group ${n}` } });
    setView({ selectedId: id });
  }

  const selectedNode = ir.nodes.find((n) => n.id === view.selectedId);
  const selectedEdge = ir.edges.find((e) => e.id === view.selectedId);
  const selectedSubgraph = ir.subgraphs.find((s) => s.id === view.selectedId);
  const selected = selectedNode ?? selectedEdge ?? selectedSubgraph;

  function handleConnectDrag(fromId: string, x: number, y: number) {
    const from = layout.nodes.find((n) => n.id === fromId) ?? layout.subgraphs.find((s) => s.id === fromId);
    if (from) setConnectLine({ x1: from.rect.x + from.rect.w / 2, y1: from.rect.y + from.rect.h / 2, x2: x, y2: y });
  }

  function handleConnectDrop(fromId: string, x: number, y: number) {
    setConnectLine(undefined);
    const from = fromId as FlowchartEndpoint;
    const inRect = (r: { x: number; y: number; w: number; h: number }) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    // nodes win over subgraphs; among subgraphs the smallest (innermost) wins
    const targetNode = layout.nodes.find((n) => n.id !== fromId && inRect(n.rect));
    const targetSubgraph = layout.subgraphs
      .filter((s) => s.id !== fromId && inRect(s.rect))
      .toSorted((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)[0];
    const target = targetNode?.id ?? targetSubgraph?.id;
    if (target === undefined) return;
    const edgeId = newId("edge");
    h.dispatch({ type: "addEdge", id: edgeId, from, to: target as FlowchartEndpoint });
    setView({ selectedId: edgeId });
  }

  // reducer rejections must be visible, not silent no-ops (L2)
  const [rejectHint, setRejectHint] = useState<string | undefined>(undefined);

  function handleElementClick(id: string) {
    const targetNode = ir.nodes.find((n) => n.id === id);
    if (view.connectFrom !== undefined && targetNode) {
      if (view.connectFrom === targetNode.id) {
        setRejectHint("self-loop edges are not supported");
        setView({ selectedId: id });
        return;
      }
      setRejectHint(undefined);
      h.dispatch({ type: "addEdge", id: newId("edge"), from: view.connectFrom, to: targetNode.id });
    }
    setView({ selectedId: id });
  }

  /** Re-point one end of the selected edge. The reducer's rules are the
   * drag-to-connect rules, so its refusal has to surface exactly where a
   * refused drop does — in the toolbar hint, never as a silent no-op. */
  function retargetEdge(ends: { from?: FlowchartEndpoint; to?: FlowchartEndpoint }) {
    if (!selectedEdge) return;
    const reason = edgeRetargetRejection(ir, selectedEdge.id, ends);
    setRejectHint(reason);
    if (reason === undefined) h.dispatch({ type: "retargetEdge", id: selectedEdge.id, ...ends });
  }

  function removeById(id: string, txn: string) {
    if (ir.nodes.some((n) => n.id === id)) h.dispatch({ type: "removeNode", id: id as NodeId }, txn);
    else if (ir.edges.some((e) => e.id === id)) h.dispatch({ type: "removeEdge", id: id as EdgeId }, txn);
    else if (ir.subgraphs.some((s) => s.id === id)) h.dispatch({ type: "removeSubgraph", id: id as SubgraphId }, txn);
  }

  /** One delete path for the toolbar button, the property window, the
   * context menu and the Delete/Backspace key — they must agree on what
   * "the selection" is. A whole selection leaves as ONE undo step: the
   * shared txn key coalesces the dispatches into a single history entry. */
  function deleteSelected(ids: readonly string[]) {
    if (ids.length === 0) return;
    const txn = `delete:${ids.join(",")}`;
    for (const id of ids) removeById(id, txn);
    setRejectHint(undefined);
    setView({});
  }

  const shell = useEditorShell({
    ir,
    layout,
    selectedId: view.selectedId,
    select: (id) => setView((v) => withSelected(v, id)),
    onDelete: deleteSelected,
    onPaste: (next) => h.pushIR(next),
    notify: setRejectHint,
    // a flowchart node's only "move" is being adopted by a subgraph as it is
    // CREATED; there is no reparent action to offer, so this kind shows no
    // Move entry rather than a dead one
    onEscape: () => {
      setRejectHint(undefined);
      setView({});
    },
    onUndo: h.undo,
    onRedo: h.redo,
  });

  return (
    <>
      <div className="toolbar">
        {mode === "standalone" && <button onClick={openFile}>Open…</button>}
        {mode === "standalone" && <button onClick={() => saveMmd(code, "flowchart.mmd")}>Save…</button>}
        <button onClick={addNode}>+ Node</button>
        <button onClick={addSubgraph}>+ Subgraph</button>
        <button
          disabled={selectedNode === undefined}
          onClick={() => selectedNode && setView({ ...view, connectFrom: selectedNode.id })}
        >
          → Connect from selected
        </button>
        <button disabled={shell.selection.count === 0} onClick={() => deleteSelected(shell.selection.ids)}>
          Delete
        </button>
        <button onClick={h.undo} disabled={!h.canUndo}>Undo</button>
        <button onClick={h.redo} disabled={!h.canRedo}>Redo</button>
        <button aria-label="Fit view" title="Fit the whole diagram in the canvas" onClick={shell.fitView}>
          ⤢ Fit
        </button>
        <SelectionTools shell={shell} />
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
        {rejectHint !== undefined && <span className="hint">{rejectHint}</span>}
      </div>
      <div className="canvas" ref={shell.canvasRef}>
        <ErrorBoundary>
          <FlowchartView
            layout={layout}
            viewState={{ selectedId: view.selectedId, selectedIds: shell.selection.ids }}
            viewport={shell.viewport}
            onViewportChange={shell.setViewport}
            onElementClick={(id, additive) => {
              // an additive click is selection ONLY: it never fires the
              // editor's own pending gesture (connect, …)
              if (!shell.selection.click(id, additive)) handleElementClick(id);
            }}
            onBackgroundClick={() => setView({})}
            select={shell.gestures}
            onConnectDrag={handleConnectDrag}
            onConnectDrop={handleConnectDrop}
            connectLine={connectLine}
            onGestureCancel={() => setConnectLine(undefined)}
          />
        </ErrorBoundary>
        <SelectionOverlay shell={shell} />
        {shell.selection.count <= 1 && selected && (
          <PropertyWindow
            element={selected}
            nodes={ir.nodes}
            subgraphs={ir.subgraphs}
            onRetargetEdge={(end, id) => retargetEdge({ [end]: id as FlowchartEndpoint })}
            onSwapEdgeEnds={() => selectedEdge && retargetEdge({ from: selectedEdge.to, to: selectedEdge.from })}
            onSelectElement={(id) => {
              setRejectHint(undefined);
              setView({ selectedId: id });
            }}
            onChangeNodeLabel={(label) =>
              selectedNode && h.dispatch({ type: "updateNode", id: selectedNode.id, label }, `node:${selectedNode.id}:label`)
            }
            onChangeNodeShape={(shape) => selectedNode && h.dispatch({ type: "updateNode", id: selectedNode.id, shape })}
            onChangeEdgeLabel={(label) =>
              selectedEdge && h.dispatch({ type: "updateEdge", id: selectedEdge.id, label }, `edge:${selectedEdge.id}:label`)
            }
            onChangeEdgeLine={(line) => selectedEdge && h.dispatch({ type: "updateEdge", id: selectedEdge.id, line })}
            onChangeEdgeHead={(which, head) =>
              selectedEdge && h.dispatch({ type: "updateEdge", id: selectedEdge.id, [which]: head })
            }
            onChangeEdgeLength={(length) => selectedEdge && h.dispatch({ type: "updateEdge", id: selectedEdge.id, length })}
            onChangeSubgraphLabel={(label) =>
              selectedSubgraph && h.dispatch({ type: "updateSubgraph", id: selectedSubgraph.id, label }, `sub:${selectedSubgraph.id}:label`)
            }
            onChangeSubgraphDirection={(direction) =>
              selectedSubgraph && h.dispatch({ type: "updateSubgraph", id: selectedSubgraph.id, direction })
            }
            onDelete={() => deleteSelected(shell.selection.ids)}
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
        initialDraft={mode === "standalone" ? initial.recoveredText : undefined}
        loadWarnings={load.warnings}
        onValidityChange={setCodeValid}
        onMermaidValidityChange={setMermaidValid}
      />
    </>
  );
}
