import { useEffect, useMemo, useState } from "react";
import {
  applyRequirementAction,
  emptyRequirementDiagram,
  newId,
  REQ_NAME_RE,
  type ElementId,
  type RelationId,
  type ReqNodeId,
  type RequirementIR,
  type RequirementId,
} from "@gmermaid/ir";
import { layoutRequirementDiagram } from "@gmermaid/layout";
import { requirementToMermaid } from "@gmermaid/mermaid-codegen";
import { parseRequirementDiagram } from "@gmermaid/mermaid-parser";
import { RequirementView } from "@gmermaid/renderer";
import { measurer } from "./measurer";
import { loadInitial, openMmd, saveMmd, useAutosave, useLoadWarnings } from "./persistence";
import { CodePane } from "./CodePane";
import { ErrorBoundary } from "./ErrorBoundary";
import { RequirementPropertyWindow, type RequirementSelection } from "./RequirementPropertyWindow";
import { SelectionOverlay, SelectionTools } from "./SelectionUI";
import { useDiagramHistory } from "./useDiagramHistory";
import { useEditorShell } from "./useEditorShell";
import { withSelected } from "./viewSelection";
import type { EditorRuntimeProps } from "./editorRuntime";

function initialIR(): RequirementIR {
  let ir = emptyRequirementDiagram();
  const req = newId("requirement");
  const elem = newId("element");
  ir = applyRequirementAction(ir, {
    type: "addRequirement",
    requirement: { id: req, name: "test_req", type: "requirement", reqId: "1", text: "the test text.", risk: "High", verifyMethod: "Test" },
  });
  ir = applyRequirementAction(ir, { type: "addElement", element: { id: elem, name: "test_entity", type: "simulation" } });
  ir = applyRequirementAction(ir, {
    type: "addRelation",
    relation: { id: newId("relation"), from: elem, to: req, type: "satisfies" },
  });
  return ir;
}

// ViewState: transient UI state, never part of the IR (ADR 0001).
interface ViewState {
  readonly selectedId?: string;
}

const STORAGE_KEY = "gmermaid:doc:requirement";

export interface EditorProps extends EditorRuntimeProps {
  readonly loadRequest?: { readonly seq: number; readonly code: string | null } | undefined;
}

export function RequirementEditor({ loadRequest, initialCode, mode = "standalone", onCodeChange, onValidityChange }: EditorProps) {
  // recoveredText: stored data that stopped parsing, poured into the code
  // pane as a broken draft for manual repair
  const [initial] = useState(() => {
    if (initialCode === undefined) return loadInitial(STORAGE_KEY, parseRequirementDiagram, initialIR);
    const parsed = parseRequirementDiagram(initialCode);
    return parsed.ok ? { ir: parsed.ir, warnings: parsed.warnings } : { ir: initialIR(), recoveredText: initialCode, warnings: [] };
  });
  const load = useLoadWarnings(initial.warnings);
  const h = useDiagramHistory(() => initial.ir, applyRequirementAction);
  const [view, setView] = useState<ViewState>({});
  // reducer rejections must be visible, not silent no-ops (L2)
  const [rejectHint, setRejectHint] = useState<string | undefined>(undefined);
  // drag-to-connect rubber band: view-transient (ADR 0001)
  const [connectLine, setConnectLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | undefined>(undefined);
  const ir = h.ir;

  const layout = useMemo(() => layoutRequirementDiagram(ir, measurer), [ir]);
  const code = useMemo(() => requirementToMermaid(ir), [ir]);
  // autosave pauses while the code pane shows a broken/stale draft
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
      const loaded = load.accept(parseRequirementDiagram(loadRequest.code), "Cannot load stored diagram");
      if (loaded !== undefined) h.pushIR(loaded);
    }
    setView({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRequest?.seq]);

  async function openFile() {
    const text = await openMmd();
    if (text === null) return;
    const opened = load.accept(parseRequirementDiagram(text), "Cannot open file");
    if (opened === undefined) return;
    shell.fitOnNextLayout();
    h.pushIR(opened);
    setView({});
  }

  const selectedRequirement = ir.requirements.find((r) => r.id === view.selectedId);
  const selectedElement = ir.elements.find((e) => e.id === view.selectedId);
  const selectedRelation = ir.relations.find((r) => r.id === view.selectedId);
  const selection: RequirementSelection | undefined = selectedRequirement
    ? { kind: "requirement", requirement: selectedRequirement }
    : selectedElement
      ? { kind: "element", element: selectedElement }
      : selectedRelation
        ? { kind: "relation", relation: selectedRelation }
        : undefined;

  /** Next free `prefix<n>` name — names are the exchange identity, so unique. */
  function freeName(prefix: string): string {
    let n = 1;
    const taken = (name: string) => ir.requirements.some((r) => r.name === name) || ir.elements.some((e) => e.name === name);
    while (taken(`${prefix}${n}`)) n += 1;
    return `${prefix}${n}`;
  }

  function addRequirement() {
    const id = newId("requirement");
    h.dispatch({ type: "addRequirement", requirement: { id, name: freeName("new_req"), type: "requirement" } });
    setView({ selectedId: id });
  }

  function addElement() {
    const id = newId("element");
    h.dispatch({ type: "addElement", element: { id, name: freeName("new_element") } });
    setView({ selectedId: id });
  }

  function removeById(id: string, txn: string) {
    if (ir.requirements.some((r) => r.id === id)) h.dispatch({ type: "removeNode", id: id as RequirementId }, txn);
    else if (ir.elements.some((e) => e.id === id)) h.dispatch({ type: "removeNode", id: id as ElementId }, txn);
    else if (ir.relations.some((r) => r.id === id)) h.dispatch({ type: "removeRelation", id: id as RelationId }, txn);
  }

  /** A whole selection leaves as ONE undo step: the shared txn key coalesces
   * the dispatches into a single history entry. */
  function deleteSelected(ids: readonly string[]) {
    if (ids.length === 0) return;
    const txn = `delete:${ids.join(",")}`;
    for (const id of ids) removeById(id, txn);
    setRejectHint(undefined);
    setView({});
  }

  function handleConnectDrag(fromId: string, x: number, y: number) {
    const from = layout.boxes.find((b) => b.id === fromId);
    if (from) setConnectLine({ x1: from.rect.x + from.rect.w / 2, y1: from.rect.y + from.rect.h / 2, x2: x, y2: y });
  }

  function handleConnectDrop(fromId: string, x: number, y: number) {
    setConnectLine(undefined);
    // dropping on the source node itself creates a self-relation
    const target = layout.boxes.find((b) => x >= b.rect.x && x <= b.rect.x + b.rect.w && y >= b.rect.y && y <= b.rect.y + b.rect.h);
    if (!target) return;
    const relId = newId("relation");
    h.dispatch({
      type: "addRelation",
      relation: { id: relId, from: fromId as ReqNodeId, to: target.id as ReqNodeId, type: "satisfies" },
    });
    setView({ selectedId: relId });
  }

  const nodeId = (selectedRequirement?.id ?? selectedElement?.id) as RequirementId | ElementId | undefined;

  const shell = useEditorShell({
    ir,
    layout,
    selectedId: view.selectedId,
    select: (id) => setView((v) => withSelected(v, id)),
    onDelete: deleteSelected,
    onPaste: (next) => h.pushIR(next),
    notify: setRejectHint,
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
        {mode === "standalone" && <button onClick={() => saveMmd(code, "requirement.mmd")}>Save…</button>}
        <button onClick={addRequirement}>+ Requirement</button>
        <button onClick={addElement}>+ Element</button>
        <button onClick={() => deleteSelected(shell.selection.ids)} disabled={selection === undefined}>
          Delete
        </button>
        <button onClick={h.undo} disabled={!h.canUndo}>Undo</button>
        <button onClick={h.redo} disabled={!h.canRedo}>Redo</button>
        <button aria-label="Fit view" title="Fit the whole diagram in the canvas" onClick={shell.fitView}>
          ⤢ Fit
        </button>
        <SelectionTools shell={shell} />
        <select
          value={ir.direction ?? "TB"}
          onChange={(e) => h.dispatch({ type: "setDirection", direction: e.target.value as NonNullable<RequirementIR["direction"]> })}
        >
          <option value="TB">Top→Bottom</option>
          <option value="LR">Left→Right</option>
          <option value="BT">Bottom→Top</option>
          <option value="RL">Right→Left</option>
        </select>
        {rejectHint !== undefined && <span className="hint">{rejectHint}</span>}
      </div>
      <div className="canvas" ref={shell.canvasRef}>
        <ErrorBoundary>
          <RequirementView
            layout={layout}
            viewState={{ selectedId: view.selectedId, selectedIds: shell.selection.ids }}
            select={shell.gestures}
            viewport={shell.viewport}
            onViewportChange={shell.setViewport}
            onElementClick={(id, additive) => {
              if (shell.selection.click(id, additive)) return;
              setView({ selectedId: id });
            }}
            onBackgroundClick={() => setView({})}
            onConnectDrag={handleConnectDrag}
            onConnectDrop={handleConnectDrop}
            connectLine={connectLine}
            onGestureCancel={() => setConnectLine(undefined)}
          />
        </ErrorBoundary>
        <SelectionOverlay shell={shell} />
        {shell.selection.count <= 1 && selection && (
          <RequirementPropertyWindow
            selection={selection}
            onChangeName={(name) => {
              // a name mermaid cannot spell used to be dropped in silence
              const reason = REQ_NAME_RE.test(name) ? undefined : "a name must be a bare identifier";
              setRejectHint(reason);
              if (reason === undefined && nodeId !== undefined) h.dispatch({ type: "renameNode", id: nodeId, name }, `req:${nodeId}:name`);
            }}
            onChangeRequirementType={(requirementType) =>
              selectedRequirement && h.dispatch({ type: "updateRequirement", id: selectedRequirement.id, requirementType })
            }
            onChangeReqId={(reqId) =>
              selectedRequirement && h.dispatch({ type: "updateRequirement", id: selectedRequirement.id, reqId }, `req:${selectedRequirement.id}:id`)
            }
            onChangeText={(text) =>
              selectedRequirement && h.dispatch({ type: "updateRequirement", id: selectedRequirement.id, text }, `req:${selectedRequirement.id}:text`)
            }
            onChangeRisk={(risk) => selectedRequirement && h.dispatch({ type: "updateRequirement", id: selectedRequirement.id, risk })}
            onChangeVerifyMethod={(verifyMethod) =>
              selectedRequirement && h.dispatch({ type: "updateRequirement", id: selectedRequirement.id, verifyMethod })
            }
            onChangeElementType={(elementType) =>
              selectedElement && h.dispatch({ type: "updateElement", id: selectedElement.id, elementType }, `elem:${selectedElement.id}:type`)
            }
            onChangeDocRef={(docRef) =>
              selectedElement && h.dispatch({ type: "updateElement", id: selectedElement.id, docRef }, `elem:${selectedElement.id}:ref`)
            }
            onChangeRelationType={(relationType) =>
              selectedRelation && h.dispatch({ type: "updateRelation", id: selectedRelation.id, relationType })
            }
            onDelete={() => deleteSelected(shell.selection.ids)}
            onEditStart={() => {}}
            onEditEnd={h.endEdit}
          />
        )}
      </div>
      <CodePane
        code={code}
        parse={parseRequirementDiagram}
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
