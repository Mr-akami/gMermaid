import { useEffect, useMemo, useState } from "react";
import {
  applyUsecaseAction,
  emptyUsecaseDiagram,
  newId,
  USECASE_NAME_RE,
  type BoundaryId,
  type UsecaseIR,
  type UsecaseNodeId,
} from "@gmermaid/ir";
import { layoutUsecase } from "@gmermaid/layout";
import { usecaseToMermaid } from "@gmermaid/mermaid-codegen";
import { parseUsecase } from "@gmermaid/mermaid-parser";
import { UsecaseView, type Viewport } from "@gmermaid/renderer";
import { measurer } from "./measurer";
import { loadInitial, openMmd, saveMmd, useAutosave, useLoadWarnings } from "./persistence";
import { CodePane } from "./CodePane";
import { ErrorBoundary } from "./ErrorBoundary";
import { UsecasePropertyWindow, type UsecaseSelection } from "./UsecasePropertyWindow";
import { useDiagramHistory } from "./useDiagramHistory";
import type { EditorRuntimeProps } from "./editorRuntime";

function initialIR(): UsecaseIR {
  const sample = `usecase-beta
direction LR
actor Customer("Customer")
actor Support("Support")
systemBoundary storefront["Storefront"]@{ type: package }
  Browse("Browse catalogue")
  Checkout("Checkout")
end
Track("Track delivery")
Customer --> Browse
Customer --> Checkout
Customer --> Track
Support --> Track
Checkout ..> : include Browse
note for Checkout "validates the cart"
`;
  const parsed = parseUsecase(sample);
  return parsed.ok ? parsed.ir : emptyUsecaseDiagram();
}

// ViewState: transient UI state, never part of the IR (ADR 0001).
interface ViewState {
  readonly selectedId?: string;
  readonly relateFrom?: UsecaseNodeId;
}

const STORAGE_KEY = "gmermaid:doc:usecase";

export interface EditorProps extends EditorRuntimeProps {
  readonly loadRequest?: { readonly seq: number; readonly code: string | null } | undefined;
}

export function UsecaseEditor({ loadRequest, initialCode, mode = "standalone", onCodeChange, onValidityChange }: EditorProps) {
  // recoveredText: stored data that stopped parsing, poured into the code
  // pane as a broken draft for manual repair
  const [initial] = useState(() => {
    if (initialCode === undefined) return loadInitial(STORAGE_KEY, parseUsecase, initialIR);
    const parsed = parseUsecase(initialCode);
    return parsed.ok ? { ir: parsed.ir, warnings: parsed.warnings } : { ir: initialIR(), recoveredText: initialCode, warnings: [] };
  });
  const load = useLoadWarnings(initial.warnings);
  const h = useDiagramHistory(() => initial.ir, applyUsecaseAction);
  const [view, setView] = useState<ViewState>({});
  // pan/zoom is ViewState (ADR 0001), held apart from the selection
  const [viewport, setViewport] = useState<Viewport | undefined>(undefined);
  // drag-to-connect rubber band: view-transient (ADR 0001)
  const [connectLine, setConnectLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | undefined>(undefined);
  const ir = h.ir;

  const layout = useMemo(() => layoutUsecase(ir, measurer), [ir]);
  const code = useMemo(() => usecaseToMermaid(ir), [ir]);
  // autosave pauses while the code pane shows a broken/stale draft
  const [codeValid, setCodeValid] = useState(initial.recoveredText === undefined);
  useAutosave(STORAGE_KEY, code, mode === "standalone" && codeValid);
  useEffect(() => onCodeChange?.(code), [code, onCodeChange]);
  useEffect(() => onValidityChange?.(codeValid), [codeValid, onValidityChange]);

  useEffect(() => {
    if (!loadRequest) return;
    if (loadRequest.code === null) {
      h.pushIR(initialIR());
    } else {
      const loaded = load.accept(parseUsecase(loadRequest.code), "Cannot load stored diagram");
      if (loaded !== undefined) h.pushIR(loaded);
    }
    setView({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRequest?.seq]);

  async function openFile() {
    const text = await openMmd();
    if (text === null) return;
    const opened = load.accept(parseUsecase(text), "Cannot open file");
    if (opened === undefined) return;
    h.pushIR(opened);
    setView({});
  }

  const selectedActor = ir.actors.find((a) => a.id === view.selectedId);
  const selectedUseCase = ir.usecases.find((u) => u.id === view.selectedId);
  const selectedBoundary = ir.boundaries.find((b) => b.id === view.selectedId);
  const selectedRelation = ir.relations.find((r) => r.id === view.selectedId);
  const selectedNote = ir.notes.find((n) => n.id === view.selectedId);
  const selection: UsecaseSelection | undefined = selectedActor
    ? { kind: "actor", actor: selectedActor }
    : selectedUseCase
      ? { kind: "usecase", usecase: selectedUseCase }
      : selectedBoundary
        ? { kind: "boundary", boundary: selectedBoundary }
        : selectedRelation
          ? { kind: "relation", relation: selectedRelation }
          : selectedNote
            ? { kind: "note", note: selectedNote }
            : undefined;

  const nodeId = selectedActor?.id ?? selectedUseCase?.id;

  /** Next free `prefix<n>` — names are the exchange identity, so unique. */
  function freeName(prefix: string): string {
    let n = 1;
    const taken = (name: string) =>
      ir.actors.some((a) => a.name === name) || ir.usecases.some((u) => u.name === name) || ir.boundaries.some((b) => b.name === name);
    while (taken(`${prefix}${n}`)) n += 1;
    return `${prefix}${n}`;
  }

  function addActor() {
    const id = newId("actor");
    h.dispatch({ type: "addActor", actor: { id, name: freeName("Actor"), variant: "default" } });
    setView({ selectedId: id });
  }

  function addUseCase() {
    const id = newId("usecase");
    h.dispatch({ type: "addUseCase", usecase: { id, name: freeName("UseCase"), shape: "ellipse" } });
    setView({ selectedId: id });
  }

  function addBoundary() {
    const id = newId("boundary");
    h.dispatch({ type: "addBoundary", boundary: { id, name: freeName("Boundary"), type: "default" } });
    setView({ selectedId: id });
  }

  function addNote() {
    if (nodeId === undefined) return;
    const id = newId("note");
    h.dispatch({ type: "addNote", note: { id, target: nodeId, text: "note" } });
    setView({ selectedId: id });
  }

  function deleteSelected() {
    if (nodeId !== undefined) h.dispatch({ type: "removeNode", id: nodeId });
    else if (selectedBoundary) h.dispatch({ type: "removeBoundary", id: selectedBoundary.id });
    else if (selectedRelation) h.dispatch({ type: "removeRelation", id: selectedRelation.id });
    else if (selectedNote) h.dispatch({ type: "removeNote", id: selectedNote.id });
    setView({});
  }

  function connect(from: UsecaseNodeId, to: UsecaseNodeId) {
    const id = newId("usecaseRelation");
    h.dispatch({ type: "addRelation", relation: { id, from, to, line: "solid", headFrom: "none", headTo: "arrow" } });
    setView({ selectedId: id });
  }

  /** Actor glyph or use case whose box contains a diagram-space point. */
  function nodeAt(x: number, y: number): UsecaseNodeId | undefined {
    const hit = [...layout.usecases, ...layout.actors].find(
      (n) => x >= n.rect.x && x <= n.rect.x + n.rect.w && y >= n.rect.y && y <= n.rect.y + n.rect.h,
    );
    return hit?.id;
  }

  function handleConnectDrag(fromId: string, x: number, y: number) {
    const from = [...layout.usecases, ...layout.actors].find((n) => n.id === fromId);
    if (from) setConnectLine({ x1: from.rect.x + from.rect.w / 2, y1: from.rect.y + from.rect.h / 2, x2: x, y2: y });
  }

  function handleConnectDrop(fromId: string, x: number, y: number) {
    setConnectLine(undefined);
    const target = nodeAt(x, y);
    if (target === undefined) return;
    connect(fromId as UsecaseNodeId, target);
  }

  function handleElementClick(id: string) {
    const target = ir.actors.find((a) => a.id === id)?.id ?? ir.usecases.find((u) => u.id === id)?.id;
    if (view.relateFrom !== undefined && target !== undefined) {
      connect(view.relateFrom, target);
      return;
    }
    setView({ selectedId: id });
  }

  return (
    <>
      <div className="toolbar">
        {mode === "standalone" && <button onClick={openFile}>Open…</button>}
        {mode === "standalone" && <button onClick={() => saveMmd(code, "usecase.mmd")}>Save…</button>}
        <button onClick={addActor}>+ Actor</button>
        <button onClick={addUseCase}>+ Use case</button>
        <button onClick={addBoundary}>+ Boundary</button>
        <button onClick={addNote} disabled={nodeId === undefined}>
          + Note
        </button>
        <button
          disabled={nodeId === undefined}
          onClick={() => nodeId !== undefined && setView({ selectedId: nodeId, relateFrom: nodeId })}
        >
          → Relation from selected
        </button>
        <button onClick={deleteSelected} disabled={selection === undefined}>
          Delete
        </button>
        <button onClick={h.undo} disabled={!h.canUndo}>
          Undo
        </button>
        <button onClick={h.redo} disabled={!h.canRedo}>
          Redo
        </button>
        <select
          value={ir.direction ?? "TB"}
          onChange={(e) => h.dispatch({ type: "setDirection", direction: e.target.value as NonNullable<UsecaseIR["direction"]> })}
        >
          <option value="TB">Top→Bottom</option>
          <option value="LR">Left→Right</option>
          <option value="BT">Bottom→Top</option>
          <option value="RL">Right→Left</option>
        </select>
        {view.relateFrom !== undefined && <span className="hint">click the target actor or use case…</span>}
      </div>
      <div className="canvas">
        <ErrorBoundary>
          <UsecaseView
            layout={layout}
            viewState={{ selectedId: view.selectedId }}
            viewport={viewport}
            onViewportChange={setViewport}
            onElementClick={handleElementClick}
            onBackgroundClick={() => setView({})}
            onConnectDrag={handleConnectDrag}
            onConnectDrop={handleConnectDrop}
            connectLine={connectLine}
            onGestureCancel={() => setConnectLine(undefined)}
          />
        </ErrorBoundary>
        {selection && (
          <UsecasePropertyWindow
            selection={selection}
            boundaries={ir.boundaries}
            onChangeName={(name) => {
              if (!USECASE_NAME_RE.test(name)) return;
              if (nodeId !== undefined) h.dispatch({ type: "renameNode", id: nodeId, name }, `uc:${nodeId}:name`);
              else if (selectedBoundary) h.dispatch({ type: "renameBoundary", id: selectedBoundary.id, name }, `uc:${selectedBoundary.id}:name`);
            }}
            onChangeLabel={(label) => {
              if (selectedActor) h.dispatch({ type: "updateActor", id: selectedActor.id, label }, `uc:${selectedActor.id}:label`);
              else if (selectedUseCase) h.dispatch({ type: "updateUseCase", id: selectedUseCase.id, label }, `uc:${selectedUseCase.id}:label`);
              else if (selectedBoundary) h.dispatch({ type: "updateBoundary", id: selectedBoundary.id, label }, `uc:${selectedBoundary.id}:label`);
            }}
            onChangeVariant={(variant) => selectedActor && h.dispatch({ type: "updateActor", id: selectedActor.id, variant })}
            onChangeShape={(shape) => selectedUseCase && h.dispatch({ type: "updateUseCase", id: selectedUseCase.id, shape })}
            onChangeBusiness={(business) => {
              if (selectedActor) h.dispatch({ type: "updateActor", id: selectedActor.id, business });
              else if (selectedUseCase) h.dispatch({ type: "updateUseCase", id: selectedUseCase.id, business });
            }}
            onChangeStereotype={(stereotype) => {
              if (selectedActor) h.dispatch({ type: "updateActor", id: selectedActor.id, stereotype }, `uc:${selectedActor.id}:st`);
              else if (selectedUseCase) h.dispatch({ type: "updateUseCase", id: selectedUseCase.id, stereotype }, `uc:${selectedUseCase.id}:st`);
            }}
            onChangeBoundary={(boundary) =>
              nodeId !== undefined &&
              h.dispatch({ type: "setNodeBoundary", id: nodeId, boundary: boundary === "" ? null : (boundary as BoundaryId) })
            }
            onChangeBoundaryType={(boundaryType) =>
              selectedBoundary && h.dispatch({ type: "updateBoundary", id: selectedBoundary.id, boundaryType })
            }
            onChangeHeadFrom={(headFrom) => selectedRelation && h.dispatch({ type: "updateRelation", id: selectedRelation.id, headFrom })}
            onChangeHeadTo={(headTo) => selectedRelation && h.dispatch({ type: "updateRelation", id: selectedRelation.id, headTo })}
            onChangeRelationLabel={(label) =>
              selectedRelation && h.dispatch({ type: "updateRelation", id: selectedRelation.id, label }, `uc:${selectedRelation.id}:label`)
            }
            onChangeRelationKind={(relationKind) =>
              selectedRelation && h.dispatch({ type: "updateRelation", id: selectedRelation.id, relationKind })
            }
            onChangeNoteText={(text) => selectedNote && h.dispatch({ type: "updateNote", id: selectedNote.id, text }, `uc:${selectedNote.id}:text`)}
            onDelete={deleteSelected}
            onEditStart={() => {}}
            onEditEnd={h.endEdit}
          />
        )}
      </div>
      <CodePane
        code={code}
        parse={parseUsecase}
        onCommit={(next) => h.pushIR(next, "code-pane")}
        onEditStart={() => {}}
        onEditEnd={h.endEdit}
        initialDraft={mode === "standalone" ? initial.recoveredText : undefined}
        loadWarnings={load.warnings}
        onValidityChange={setCodeValid}
      />
    </>
  );
}
