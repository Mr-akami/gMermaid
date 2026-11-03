import { useEffect, useMemo, useState } from "react";
import {
  applyErAction,
  emptyErDiagram,
  erAttributeRejection,
  erRetargetRejection,
  ER_NAME_RE,
  newId,
  type AttributeId,
  type EntityId,
  type ErIR,
  type ErKey,
  type RelationId,
} from "@gmermaid/ir";
import { layoutEr } from "@gmermaid/layout";
import { erToMermaid } from "@gmermaid/mermaid-codegen";
import { parseErDiagram } from "@gmermaid/mermaid-parser";
import { ErView } from "@gmermaid/renderer";
import { measurer } from "./measurer";
import { loadInitial, openMmd, saveMmd, useAutosave, useLoadWarnings } from "./persistence";
import { CodePane } from "./CodePane";
import { ErrorBoundary } from "./ErrorBoundary";
import { ErPropertyWindow, type ErSelection } from "./ErPropertyWindow";
import { SelectionOverlay } from "./SelectionUI";
import { DeleteButton, DirectionSelect, EditorToolbar } from "./EditorToolbar";
import { useDiagramHistory } from "./useDiagramHistory";
import { useEditorShell } from "./useEditorShell";
import { withSelected } from "./viewSelection";
import type { EditorRuntimeProps } from "./editorRuntime";

function initialIR(): ErIR {
  let ir = emptyErDiagram();
  const customer = newId("entity");
  const order = newId("entity");
  const item = newId("entity");
  ir = applyErAction(ir, {
    type: "addEntity",
    entity: {
      id: customer,
      name: "CUSTOMER",
      attributes: [
        { id: newId("attribute"), type: "string", name: "name", keys: [] },
        { id: newId("attribute"), type: "string", name: "custNumber", keys: ["PK"] },
        { id: newId("attribute"), type: "string", name: "sector", keys: [] },
      ],
    },
  });
  ir = applyErAction(ir, {
    type: "addEntity",
    entity: { id: order, name: "ORDER", attributes: [{ id: newId("attribute"), type: "int", name: "orderNumber", keys: ["PK"] }] },
  });
  ir = applyErAction(ir, { type: "addEntity", entity: { id: item, name: "LINE_ITEM", attributes: [] } });
  ir = applyErAction(ir, {
    type: "addRelationship",
    relationship: { id: newId("relation"), from: customer, to: order, fromCard: "exactly-one", toCard: "zero-or-more", identifying: true, label: "places" },
  });
  ir = applyErAction(ir, {
    type: "addRelationship",
    relationship: { id: newId("relation"), from: order, to: item, fromCard: "exactly-one", toCard: "one-or-more", identifying: true, label: "contains" },
  });
  return ir;
}

// ViewState: transient UI state, never part of the IR (ADR 0001).
interface ViewState {
  readonly selectedId?: string;
}

const STORAGE_KEY = "gmermaid:doc:er";

export interface EditorProps extends EditorRuntimeProps {
  readonly loadRequest?: { readonly seq: number; readonly code: string | null } | undefined;
}

export function ErEditor({ loadRequest, initialCode, mode = "standalone", onCodeChange, onValidityChange }: EditorProps) {
  // recoveredText: stored data that stopped parsing, poured into the code
  // pane as a broken draft for manual repair
  const [initial] = useState(() => {
    if (initialCode === undefined) return loadInitial(STORAGE_KEY, parseErDiagram, initialIR);
    const parsed = parseErDiagram(initialCode);
    return parsed.ok ? { ir: parsed.ir, warnings: parsed.warnings } : { ir: initialIR(), recoveredText: initialCode, warnings: [] };
  });
  const load = useLoadWarnings(initial.warnings);
  const h = useDiagramHistory(() => initial.ir, applyErAction);
  const [view, setView] = useState<ViewState>({});
  // reducer rejections must be visible, not silent no-ops (L2)
  const [rejectHint, setRejectHint] = useState<string | undefined>(undefined);
  // drag-to-connect rubber band: view-transient (ADR 0001)
  const [connectLine, setConnectLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | undefined>(undefined);
  const ir = h.ir;

  const layout = useMemo(() => layoutEr(ir, measurer), [ir]);
  const code = useMemo(() => erToMermaid(ir), [ir]);
  // autosave pauses while the code pane shows a broken/stale draft
  const [codeValid, setCodeValid] = useState(initial.recoveredText === undefined);
  useAutosave(STORAGE_KEY, code, mode === "standalone" && codeValid);
  // autosave follows OUR parser alone; mermaid's verdict travels separately
  // and only gates the review submit.
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
      const loaded = load.accept(parseErDiagram(loadRequest.code), "Cannot load stored diagram");
      if (loaded !== undefined) h.pushIR(loaded);
    }
    setView({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRequest?.seq]);

  async function openFile() {
    const text = await openMmd();
    if (text === null) return;
    const opened = load.accept(parseErDiagram(text), "Cannot open file");
    if (opened === undefined) return;
    shell.fitOnNextLayout();
    h.pushIR(opened);
    setView({});
  }

  const selectedEntity = ir.entities.find((e) => e.id === view.selectedId);
  const selectedRelationship = ir.relationships.find((r) => r.id === view.selectedId);
  const selection: ErSelection | undefined = selectedEntity
    ? { kind: "entity", entity: selectedEntity }
    : selectedRelationship
      ? { kind: "relationship", relationship: selectedRelationship }
      : undefined;

  /** Next free `ENTITY<n>` name — names are the exchange identity, so unique. */
  function freeName(): string {
    let n = 1;
    while (ir.entities.some((e) => e.name === `ENTITY${n}`)) n += 1;
    return `ENTITY${n}`;
  }

  function addEntity() {
    const id = newId("entity");
    h.dispatch({ type: "addEntity", entity: { id, name: freeName(), attributes: [] } });
    setView({ selectedId: id });
  }

  function addAttribute() {
    if (!selectedEntity) return;
    let n = selectedEntity.attributes.length + 1;
    while (selectedEntity.attributes.some((a) => a.name === `attr${n}`)) n += 1;
    h.dispatch({ type: "addAttribute", entityId: selectedEntity.id, attribute: { id: newId("attribute"), type: "string", name: `attr${n}`, keys: [] } });
  }

  function changeAttribute(id: AttributeId, patch: { attrType?: string; name?: string; keys?: readonly ErKey[]; comment?: string }) {
    if (!selectedEntity) return;
    const a = selectedEntity.attributes.find((x) => x.id === id);
    if (!a) return;
    // a type / name mermaid cannot spell used to be dropped in silence
    const reason = erAttributeRejection(patch.attrType ?? a.type, patch.name ?? a.name);
    setRejectHint(reason);
    if (reason !== undefined) return;
    const txn = patch.attrType !== undefined ? "type" : patch.name !== undefined ? "name" : patch.comment !== undefined ? "comment" : undefined;
    h.dispatch({ type: "updateAttribute", entityId: selectedEntity.id, id, ...patch }, txn === undefined ? undefined : `er:${id}:${txn}`);
  }

  /** Re-point one end of the selected relationship; the reducer's rules are
   * the drag-to-connect rules, so a refusal surfaces in the toolbar hint. */
  function retarget(ends: { from?: EntityId; to?: EntityId }) {
    if (!selectedRelationship) return;
    const reason = erRetargetRejection(ir, selectedRelationship.id, ends);
    setRejectHint(reason);
    if (reason === undefined) h.dispatch({ type: "retargetRelationship", id: selectedRelationship.id, ...ends });
  }

  function removeById(id: string, txn: string) {
    if (ir.entities.some((e) => e.id === id)) h.dispatch({ type: "removeEntity", id: id as EntityId }, txn);
    else if (ir.relationships.some((r) => r.id === id)) h.dispatch({ type: "removeRelationship", id: id as RelationId }, txn);
  }

  /** A whole selection leaves as ONE undo step (shared txn key). */
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
    // dropping on the source entity itself creates a self-relationship
    const target = layout.boxes.find((b) => x >= b.rect.x && x <= b.rect.x + b.rect.w && y >= b.rect.y && y <= b.rect.y + b.rect.h);
    if (!target) return;
    const relId = newId("relation");
    h.dispatch({
      type: "addRelationship",
      relationship: { id: relId, from: fromId as EntityId, to: target.id, fromCard: "exactly-one", toCard: "zero-or-more", identifying: true },
    });
    setView({ selectedId: relId });
  }

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
      <EditorToolbar
        shell={shell}
        history={h}
        file={mode === "standalone" ? { open: openFile, save: () => saveMmd(code, "er.mmd") } : undefined}
        tools={<button className="btn" onClick={addEntity}>+ Entity</button>}
        settings={<DirectionSelect value={ir.direction ?? "TB"} onChange={(direction) => h.dispatch({ type: "setDirection", direction })} />}
        selectionActions={<DeleteButton onClick={() => deleteSelected(shell.selection.ids)} />}
        notice={rejectHint}
      />
      <div className="canvas" ref={shell.canvasRef}>
        <ErrorBoundary>
          <ErView
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
          <ErPropertyWindow
            selection={selection}
            entities={ir.entities}
            onRetarget={(end, id) => retarget({ [end]: id as EntityId })}
            onSwapEnds={() => selectedRelationship && retarget({ from: selectedRelationship.to, to: selectedRelationship.from })}
            onSelectEntity={(id) => {
              setRejectHint(undefined);
              setView({ selectedId: id });
            }}
            onChangeName={(name) => {
              // a name mermaid cannot spell used to be dropped in silence
              const reason = ER_NAME_RE.test(name) ? undefined : "a name cannot be empty or contain quotes";
              setRejectHint(reason);
              if (reason === undefined && selectedEntity) h.dispatch({ type: "renameEntity", id: selectedEntity.id, name }, `er:${selectedEntity.id}:name`);
            }}
            onChangeAlias={(alias) => selectedEntity && h.dispatch({ type: "setAlias", id: selectedEntity.id, alias }, `er:${selectedEntity.id}:alias`)}
            onAddAttribute={addAttribute}
            onChangeAttribute={changeAttribute}
            onMoveAttribute={(id, to) => selectedEntity && h.dispatch({ type: "moveAttribute", entityId: selectedEntity.id, id, to })}
            onRemoveAttribute={(id) => selectedEntity && h.dispatch({ type: "removeAttribute", entityId: selectedEntity.id, id })}
            onChangeCard={(end, card) =>
              selectedRelationship &&
              h.dispatch({ type: "updateRelationship", id: selectedRelationship.id, ...(end === "from" ? { fromCard: card } : { toCard: card }) })
            }
            onChangeIdentifying={(identifying) => selectedRelationship && h.dispatch({ type: "updateRelationship", id: selectedRelationship.id, identifying })}
            onChangeLabel={(label) =>
              selectedRelationship && h.dispatch({ type: "updateRelationship", id: selectedRelationship.id, label }, `er:${selectedRelationship.id}:label`)
            }
            onDelete={() => deleteSelected(shell.selection.ids)}
            onEditStart={() => {}}
            onEditEnd={h.endEdit}
          />
        )}
      </div>
      <CodePane
        code={code}
        parse={parseErDiagram}
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
