import { useEffect, useMemo, useState } from "react";
import {
  applyMindmapAction,
  emptyMindmap,
  mindmapChildren,
  mindmapLabelRejection,
  mindmapMoveRejection,
  mindmapRoot,
  newId,
  type MindmapIR,
  type MindmapNodeId,
} from "@gmermaid/ir";
import { layoutMindmap } from "@gmermaid/layout";
import { mindmapToMermaid } from "@gmermaid/mermaid-codegen";
import { parseMindmap } from "@gmermaid/mermaid-parser";
import { MindmapView, type Viewport } from "@gmermaid/renderer";
import { measurer } from "./measurer";
import { loadInitial, openMmd, saveMmd, useAutosave, useLoadWarnings } from "./persistence";
import { CodePane } from "./CodePane";
import { ErrorBoundary } from "./ErrorBoundary";
import { MindmapPropertyWindow } from "./MindmapPropertyWindow";
import { useDiagramHistory } from "./useDiagramHistory";
import type { EditorRuntimeProps } from "./editorRuntime";

function initialIR(): MindmapIR {
  const sample = `mindmap
  root((mindmap))
    Origins
      Long history
      ::icon(fa fa-book)
      Popularisation
        British popular psychology author Tony Buzan
    Research
      On effectiveness<br/>and features
      On Automatic creation
    Tools
      Pen and paper
      Mermaid
`;
  const parsed = parseMindmap(sample);
  return parsed.ok ? parsed.ir : emptyMindmap();
}

// ViewState: transient UI state, never part of the IR (ADR 0001).
interface ViewState {
  readonly selectedId?: string;
}

const STORAGE_KEY = "gmermaid:doc:mindmap";

export interface EditorProps extends EditorRuntimeProps {
  readonly loadRequest?: { readonly seq: number; readonly code: string | null } | undefined;
}

export function MindmapEditor({ loadRequest, initialCode, mode = "standalone", onCodeChange, onValidityChange }: EditorProps) {
  // recoveredText: stored data that stopped parsing, poured into the code
  // pane as a broken draft for manual repair (S1-3)
  const [initial] = useState(() => {
    if (initialCode === undefined) return loadInitial(STORAGE_KEY, parseMindmap, initialIR);
    const parsed = parseMindmap(initialCode);
    return parsed.ok ? { ir: parsed.ir, warnings: parsed.warnings } : { ir: initialIR(), recoveredText: initialCode, warnings: [] };
  });
  const load = useLoadWarnings(initial.warnings);
  const h = useDiagramHistory(() => initial.ir, applyMindmapAction);
  const [view, setView] = useState<ViewState>({});
  // pan/zoom is ViewState (ADR 0001), held apart from the selection
  const [viewport, setViewport] = useState<Viewport | undefined>(undefined);
  // drag-to-reparent rubber band: view-transient (ADR 0001)
  const [connectLine, setConnectLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | undefined>(undefined);
  // reducer rejections must be visible, not silent no-ops (L2)
  const [rejectHint, setRejectHint] = useState<string | undefined>(undefined);
  const ir = h.ir;

  const layout = useMemo(() => layoutMindmap(ir, measurer), [ir]);
  const code = useMemo(() => mindmapToMermaid(ir), [ir]);
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
    if (loadRequest.code === null) {
      h.pushIR(initialIR());
    } else {
      const loaded = load.accept(parseMindmap(loadRequest.code), "Cannot load stored diagram");
      if (loaded !== undefined) h.pushIR(loaded);
    }
    setView({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRequest?.seq]);

  async function openFile() {
    const text = await openMmd();
    if (text === null) return;
    const opened = load.accept(parseMindmap(text), "Cannot open file");
    if (opened === undefined) return;
    h.pushIR(opened);
    setView({});
  }

  const selected = ir.nodes.find((n) => n.id === view.selectedId);
  const siblings = selected?.parent !== undefined ? mindmapChildren(ir, selected.parent) : [];
  const siblingAt = siblings.findIndex((n) => n.id === selected?.id);

  /** `Idea 1`, `Idea 2`, … skipping labels already in use. */
  function uniqueLabel(): string {
    const taken = ir.nodes.map((n) => n.label);
    let n = 1;
    while (taken.includes(`Idea ${n}`)) n += 1;
    return `Idea ${n}`;
  }

  function addChild() {
    // with no diagram at all the first node becomes the root
    const parent = selected?.id ?? mindmapRoot(ir)?.id;
    const id: MindmapNodeId = newId("mindmapNode");
    h.dispatch({
      type: "addNode",
      node: { id, label: parent === undefined ? "Root" : uniqueLabel(), shape: parent === undefined ? "circle" : "default", ...(parent !== undefined ? { parent } : {}) },
    });
    setRejectHint(undefined);
    setView({ selectedId: id });
  }

  function addSibling() {
    if (!selected || selected.parent === undefined) {
      setRejectHint("the root has no siblings");
      return;
    }
    const id: MindmapNodeId = newId("mindmapNode");
    h.dispatch({
      type: "addNode",
      node: { id, label: uniqueLabel(), shape: "default", parent: selected.parent },
      after: selected.id,
    });
    setRejectHint(undefined);
    setView({ selectedId: id });
  }

  function deleteSelected() {
    if (!selected) return;
    h.dispatch({ type: "removeNode", id: selected.id });
    setRejectHint(undefined);
    setView({});
  }

  function handleConnectDrag(fromId: string, x: number, y: number) {
    const from = layout.nodes.find((n) => n.id === fromId);
    if (from) setConnectLine({ x1: from.rect.x + from.rect.w / 2, y1: from.rect.y + from.rect.h / 2, x2: x, y2: y });
  }

  function handleConnectDrop(fromId: string, x: number, y: number) {
    setConnectLine(undefined);
    const target = layout.nodes.find(
      (n) => n.id !== fromId && x >= n.rect.x && x <= n.rect.x + n.rect.w && y >= n.rect.y && y <= n.rect.y + n.rect.h,
    );
    if (!target) return;
    const reason = mindmapMoveRejection(ir, fromId as MindmapNodeId, target.id);
    setRejectHint(reason);
    if (reason !== undefined) return;
    h.dispatch({ type: "moveNode", id: fromId as MindmapNodeId, parent: target.id });
    setView({ selectedId: fromId });
  }

  return (
    <>
      <div className="toolbar">
        {mode === "standalone" && <button onClick={openFile}>Open…</button>}
        {mode === "standalone" && <button onClick={() => saveMmd(code, "mindmap.mmd")}>Save…</button>}
        <button onClick={addChild}>+ Child</button>
        <button disabled={selected === undefined || selected.parent === undefined} onClick={addSibling}>
          + Sibling
        </button>
        <button disabled={selected === undefined} onClick={deleteSelected}>
          Delete subtree
        </button>
        <button onClick={h.undo} disabled={!h.canUndo}>
          Undo
        </button>
        <button onClick={h.redo} disabled={!h.canRedo}>
          Redo
        </button>
        <span className="hint">drag a node onto another to re-parent it</span>
        {rejectHint !== undefined && <span className="hint">{rejectHint}</span>}
      </div>
      <div className="canvas">
        <ErrorBoundary>
          <MindmapView
            layout={layout}
            viewState={{ selectedId: view.selectedId }}
            viewport={viewport}
            onViewportChange={setViewport}
            onElementClick={(id) => {
              setRejectHint(undefined);
              setView({ selectedId: id });
            }}
            onBackgroundClick={() => setView({})}
            onConnectDrag={handleConnectDrag}
            onConnectDrop={handleConnectDrop}
            connectLine={connectLine}
            onGestureCancel={() => setConnectLine(undefined)}
          />
        </ErrorBoundary>
        {selected && (
          <MindmapPropertyWindow
            node={selected}
            canMoveUp={siblingAt > 0}
            canMoveDown={siblingAt >= 0 && siblingAt < siblings.length - 1}
            onChangeLabel={(label) => {
              const reason = mindmapLabelRejection(label);
              setRejectHint(reason);
              if (reason === undefined) h.dispatch({ type: "updateNode", id: selected.id, label }, `mm:${selected.id}:label`);
            }}
            onChangeShape={(shape) => h.dispatch({ type: "updateNode", id: selected.id, shape })}
            onChangeIcon={(icon) => h.dispatch({ type: "updateNode", id: selected.id, icon }, `mm:${selected.id}:icon`)}
            onMove={(delta) => h.dispatch({ type: "reorderNode", id: selected.id, delta })}
            onDelete={deleteSelected}
            onEditStart={() => {}}
            onEditEnd={h.endEdit}
          />
        )}
      </div>
      <CodePane
        code={code}
        parse={parseMindmap}
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
