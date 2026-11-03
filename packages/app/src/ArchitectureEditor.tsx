import { useEffect, useMemo, useState } from "react";
import {
  applyArchitectureAction,
  archEdgeRetargetRejection,
  archGroupChain,
  archNameRejection,
  archNodeGroup,
  emptyArchitectureDiagram,
  newId,
  type ArchEdgeId,
  type ArchGroupId,
  type ArchNodeId,
  type ArchSide,
  type ArchitectureIR,
} from "@gmermaid/ir";
import { layoutArchitecture, type Rect } from "@gmermaid/layout";
import { architectureToMermaid } from "@gmermaid/mermaid-codegen";
import { parseArchitecture } from "@gmermaid/mermaid-parser";
import { ArchitectureView } from "@gmermaid/renderer";
import { measurer } from "./measurer";
import { loadInitial, openMmd, saveMmd, useAutosave, useLoadWarnings } from "./persistence";
import { CodePane } from "./CodePane";
import { ErrorBoundary } from "./ErrorBoundary";
import { ArchitecturePropertyWindow, type ArchitectureSelection } from "./ArchitecturePropertyWindow";
import { SelectionOverlay } from "./SelectionUI";
import { DeleteButton, EditorToolbar } from "./EditorToolbar";
import { useDiagramHistory } from "./useDiagramHistory";
import { useEditorShell } from "./useEditorShell";
import { withSelected } from "./viewSelection";
import type { EditorRuntimeProps } from "./editorRuntime";

function initialIR(): ArchitectureIR {
  const sample = `architecture-beta
  group api(cloud)["API"]
  service db(database)["Database"] in api
  service disk1(disk)["Storage"] in api
  service server(server)["Server"] in api
  service gateway(internet)["Gateway"]
  junction fork
  db:L -- R:server
  disk1:T -- B:server
  server:T -- B:fork
  fork:R -["reads"]-> L:gateway
`;
  const parsed = parseArchitecture(sample);
  return parsed.ok ? parsed.ir : emptyArchitectureDiagram();
}

// ViewState: transient UI state, never part of the IR (ADR 0001).
interface ViewState {
  readonly selectedId?: string;
  readonly relateFrom?: ArchNodeId;
}

const STORAGE_KEY = "gmermaid:doc:architecture";

export interface EditorProps extends EditorRuntimeProps {
  readonly loadRequest?: { readonly seq: number; readonly code: string | null } | undefined;
}

/** Ports for a new edge: the sides that face each other along the axis the
 * two boxes are further apart on, so a fresh edge reads as the layout shows it. */
function facingSides(from: Rect, to: Rect): { fromSide: ArchSide; toSide: ArchSide } {
  const dx = to.x + to.w / 2 - (from.x + from.w / 2);
  const dy = to.y + to.h / 2 - (from.y + from.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { fromSide: "R", toSide: "L" } : { fromSide: "L", toSide: "R" };
  return dy >= 0 ? { fromSide: "B", toSide: "T" } : { fromSide: "T", toSide: "B" };
}

export function ArchitectureEditor({ loadRequest, initialCode, mode = "standalone", onCodeChange, onValidityChange }: EditorProps) {
  const [initial] = useState(() => {
    if (initialCode === undefined) return loadInitial(STORAGE_KEY, parseArchitecture, initialIR);
    const parsed = parseArchitecture(initialCode);
    return parsed.ok ? { ir: parsed.ir, warnings: parsed.warnings } : { ir: initialIR(), recoveredText: initialCode, warnings: [] };
  });
  const load = useLoadWarnings(initial.warnings);
  const h = useDiagramHistory(() => initial.ir, applyArchitectureAction);
  const [view, setView] = useState<ViewState>({});
  // reducer rejections must be visible, not silent no-ops (L2)
  const [rejectHint, setRejectHint] = useState<string | undefined>(undefined);
  // drag-to-connect rubber band: view-transient (ADR 0001)
  const [connectLine, setConnectLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | undefined>(undefined);
  const ir = h.ir;

  const layout = useMemo(() => layoutArchitecture(ir, measurer), [ir]);
  const code = useMemo(() => architectureToMermaid(ir), [ir]);
  const [codeValid, setCodeValid] = useState(initial.recoveredText === undefined);
  useAutosave(STORAGE_KEY, code, mode === "standalone" && codeValid);
  // autosave follows OUR parser alone; mermaid's verdict only gates review submit
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
      const loaded = load.accept(parseArchitecture(loadRequest.code), "Cannot load stored diagram");
      if (loaded !== undefined) h.pushIR(loaded);
    }
    setView({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRequest?.seq]);

  async function openFile() {
    const text = await openMmd();
    if (text === null) return;
    const opened = load.accept(parseArchitecture(text), "Cannot open file");
    if (opened === undefined) return;
    shell.fitOnNextLayout();
    h.pushIR(opened);
    setView({});
  }

  const selectedService = ir.services.find((s) => s.id === view.selectedId);
  const selectedJunction = ir.junctions.find((j) => j.id === view.selectedId);
  const selectedGroup = ir.groups.find((g) => g.id === view.selectedId);
  const selectedEdge = ir.edges.find((e) => e.id === view.selectedId);
  const selection: ArchitectureSelection | undefined = selectedService
    ? { kind: "service", service: selectedService }
    : selectedJunction
      ? { kind: "junction", junction: selectedJunction }
      : selectedGroup
        ? { kind: "group", group: selectedGroup }
        : selectedEdge
          ? { kind: "edge", edge: selectedEdge }
          : undefined;

  const nodeId = selectedService?.id ?? selectedJunction?.id;

  /** Next free `prefix<n>` — names are the exchange identity, so unique. */
  function freeName(prefix: string): string {
    let n = 1;
    const taken = (name: string) =>
      ir.groups.some((g) => g.name === name) || ir.services.some((s) => s.name === name) || ir.junctions.some((j) => j.name === name);
    while (taken(`${prefix}${n}`)) n += 1;
    return `${prefix}${n}`;
  }

  /** New elements land in the selected group, or beside the selected member. */
  const targetGroup = (): ArchGroupId | undefined =>
    selectedGroup?.id ?? (nodeId !== undefined ? archNodeGroup(ir, nodeId) : undefined);

  function addService() {
    const id = newId("archService");
    const group = targetGroup();
    h.dispatch({ type: "addService", service: { id, name: freeName("service"), icon: "server", ...(group !== undefined ? { group } : {}) } });
    setView({ selectedId: id });
  }

  function addJunction() {
    const id = newId("archJunction");
    const group = targetGroup();
    h.dispatch({ type: "addJunction", junction: { id, name: freeName("junction"), ...(group !== undefined ? { group } : {}) } });
    setView({ selectedId: id });
  }

  function addGroup() {
    const id = newId("archGroup");
    h.dispatch({
      type: "addGroup",
      group: { id, name: freeName("group"), label: "Group", icon: "cloud", ...(selectedGroup ? { parent: selectedGroup.id } : {}) },
    });
    setView({ selectedId: id });
  }

  /** Re-point one end of the selected edge. The reducer's rules are the
   * drag-to-connect rules, so a refusal surfaces in the toolbar hint. */
  function retargetEdge(ends: { from?: ArchNodeId; to?: ArchNodeId }) {
    if (!selectedEdge) return;
    const reason = archEdgeRetargetRejection(ir, selectedEdge.id, ends);
    setRejectHint(reason);
    if (reason === undefined) h.dispatch({ type: "retargetEdge", id: selectedEdge.id, ...ends });
  }

  function removeById(id: string, txn: string) {
    if (ir.services.some((s) => s.id === id) || ir.junctions.some((j) => j.id === id)) {
      h.dispatch({ type: "removeNode", id: id as ArchNodeId }, txn);
    } else if (ir.groups.some((g) => g.id === id)) h.dispatch({ type: "removeGroup", id: id as ArchGroupId }, txn);
    else if (ir.edges.some((e) => e.id === id)) h.dispatch({ type: "removeEdge", id: id as ArchEdgeId }, txn);
  }

  /** A whole selection leaves as ONE undo step (shared txn key). */
  function deleteSelected(ids: readonly string[]) {
    if (ids.length === 0) return;
    const txn = `delete:${ids.join(",")}`;
    for (const id of ids) removeById(id, txn);
    setRejectHint(undefined);
    setView({});
  }

  const nodeRects = [...layout.services, ...layout.junctions];

  function connect(from: ArchNodeId, to: ArchNodeId) {
    if (from === to) {
      setRejectHint("an edge cannot connect a node to itself");
      return;
    }
    const a = nodeRects.find((n) => n.id === from);
    const b = nodeRects.find((n) => n.id === to);
    const sides = a && b ? facingSides(a.rect, b.rect) : { fromSide: "R" as const, toSide: "L" as const };
    const id = newId("archEdge");
    h.dispatch({ type: "addEdge", edge: { id, from, to, ...sides, arrowFrom: false, arrowTo: true } });
    setView({ selectedId: id });
  }

  /** Service or junction whose box contains a diagram-space point. */
  function nodeAt(x: number, y: number): ArchNodeId | undefined {
    const hit = nodeRects.find((n) => x >= n.rect.x && x <= n.rect.x + n.rect.w && y >= n.rect.y && y <= n.rect.y + n.rect.h);
    return hit?.id;
  }

  function handleConnectDrag(fromId: string, x: number, y: number) {
    const from = nodeRects.find((n) => n.id === fromId);
    if (from) setConnectLine({ x1: from.rect.x + from.rect.w / 2, y1: from.rect.y + from.rect.h / 2, x2: x, y2: y });
  }

  function handleConnectDrop(fromId: string, x: number, y: number) {
    setConnectLine(undefined);
    const target = nodeAt(x, y);
    if (target === undefined) return;
    connect(fromId as ArchNodeId, target);
  }

  function handleElementClick(id: string) {
    const target = ir.services.find((s) => s.id === id)?.id ?? ir.junctions.find((j) => j.id === id)?.id;
    if (view.relateFrom !== undefined && target !== undefined) {
      connect(view.relateFrom, target);
      return;
    }
    setView({ selectedId: id });
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

  // groups a member may join / a group may nest in: never a group inside itself
  const groupOptions = selectedGroup ? ir.groups.filter((g) => !archGroupChain(ir, g.id).includes(selectedGroup.id)) : ir.groups;

  const edgeGroupFlag = (end: ArchNodeId | undefined, other: ArchNodeId | undefined): boolean => {
    if (end === undefined || other === undefined) return false;
    const g = archNodeGroup(ir, end);
    return g !== undefined && g !== archNodeGroup(ir, other);
  };

  return (
    <>
      <EditorToolbar
        shell={shell}
        history={h}
        file={mode === "standalone" ? { open: openFile, save: () => saveMmd(code, "architecture.mmd") } : undefined}
        tools={
          <>
            <button className="btn" onClick={addService}>+ Service</button>
            <button className="btn" onClick={addGroup}>+ Group</button>
            <button className="btn" onClick={addJunction}>+ Junction</button>
          </>
        }
        selectionActions={
          <>
            {nodeId !== undefined && (
              <button className="btn" onClick={() => setView({ selectedId: nodeId, relateFrom: nodeId })}>
                → Edge from selected
              </button>
            )}
            <DeleteButton onClick={() => deleteSelected(shell.selection.ids)} />
          </>
        }
        prompt={view.relateFrom !== undefined ? "click the target service or junction…" : undefined}
        notice={rejectHint}
      />
      <div className="canvas" ref={shell.canvasRef}>
        <ErrorBoundary>
          <ArchitectureView
            layout={layout}
            viewState={{ selectedId: view.selectedId, selectedIds: shell.selection.ids }}
            select={shell.gestures}
            viewport={shell.viewport}
            onViewportChange={shell.setViewport}
            onElementClick={(id, additive) => {
              // an additive click is selection ONLY: it never fires the
              // editor's own pending gesture (connect, …)
              if (!shell.selection.click(id, additive)) handleElementClick(id);
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
          <ArchitecturePropertyWindow
            selection={selection}
            groupOptions={groupOptions}
            services={ir.services}
            junctions={ir.junctions}
            canGroupFrom={selectedEdge ? edgeGroupFlag(selectedEdge.from, selectedEdge.to) : false}
            canGroupTo={selectedEdge ? edgeGroupFlag(selectedEdge.to, selectedEdge.from) : false}
            onRetargetEdge={(end, id) => retargetEdge({ [end]: id as ArchNodeId })}
            onSwapEdgeEnds={() => selectedEdge && retargetEdgeSwap()}
            onSelectElement={(id) => {
              setRejectHint(undefined);
              setView({ selectedId: id });
            }}
            onChangeName={(name) => {
              const reason = archNameRejection(name);
              setRejectHint(reason);
              if (reason !== undefined) return;
              const id = view.selectedId;
              if (id !== undefined) h.dispatch({ type: "rename", id: id as ArchNodeId, name }, `arch:${id}:name`);
            }}
            onChangeLabel={(label) => {
              if (selectedService) h.dispatch({ type: "updateService", id: selectedService.id, label }, `arch:${selectedService.id}:label`);
              else if (selectedGroup) h.dispatch({ type: "updateGroup", id: selectedGroup.id, label }, `arch:${selectedGroup.id}:label`);
            }}
            onChangeIcon={(icon) => {
              if (selectedService) h.dispatch({ type: "updateService", id: selectedService.id, icon }, `arch:${selectedService.id}:icon`);
              else if (selectedGroup) h.dispatch({ type: "updateGroup", id: selectedGroup.id, icon }, `arch:${selectedGroup.id}:icon`);
            }}
            onChangeGroup={(group) => {
              if (nodeId !== undefined) h.dispatch({ type: "setNodeGroup", id: nodeId, group: group === "" ? null : (group as ArchGroupId) });
              else if (selectedGroup) {
                h.dispatch({ type: "setGroupParent", id: selectedGroup.id, parent: group === "" ? null : (group as ArchGroupId) });
              }
            }}
            onChangeFromSide={(fromSide) => selectedEdge && h.dispatch({ type: "updateEdge", id: selectedEdge.id, fromSide })}
            onChangeToSide={(toSide) => selectedEdge && h.dispatch({ type: "updateEdge", id: selectedEdge.id, toSide })}
            onChangeArrowFrom={(arrowFrom) => selectedEdge && h.dispatch({ type: "updateEdge", id: selectedEdge.id, arrowFrom })}
            onChangeArrowTo={(arrowTo) => selectedEdge && h.dispatch({ type: "updateEdge", id: selectedEdge.id, arrowTo })}
            onChangeGroupFrom={(groupFrom) => selectedEdge && h.dispatch({ type: "updateEdge", id: selectedEdge.id, groupFrom })}
            onChangeGroupTo={(groupTo) => selectedEdge && h.dispatch({ type: "updateEdge", id: selectedEdge.id, groupTo })}
            onChangeEdgeLabel={(label) =>
              selectedEdge && h.dispatch({ type: "updateEdge", id: selectedEdge.id, label }, `arch:${selectedEdge.id}:label`)
            }
            onDelete={() => deleteSelected(shell.selection.ids)}
            onEditStart={() => {}}
            onEditEnd={h.endEdit}
          />
        )}
      </div>
      <CodePane
        code={code}
        parse={parseArchitecture}
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

  /** Swap the ends AND their ports, so the edge keeps leaving the same sides. */
  function retargetEdgeSwap() {
    if (!selectedEdge) return;
    const reason = archEdgeRetargetRejection(ir, selectedEdge.id, { from: selectedEdge.to, to: selectedEdge.from });
    setRejectHint(reason);
    if (reason !== undefined) return;
    const txn = `swap:${selectedEdge.id}`;
    h.dispatch({ type: "retargetEdge", id: selectedEdge.id, from: selectedEdge.to, to: selectedEdge.from }, txn);
    h.dispatch(
      {
        type: "updateEdge",
        id: selectedEdge.id,
        fromSide: selectedEdge.toSide,
        toSide: selectedEdge.fromSide,
        arrowFrom: selectedEdge.arrowTo,
        arrowTo: selectedEdge.arrowFrom,
        groupFrom: selectedEdge.groupTo === true,
        groupTo: selectedEdge.groupFrom === true,
      },
      txn,
    );
  }
}
