import { useEffect, useMemo, useState } from "react";
import {
  applyQuadrantAction,
  emptyQuadrant,
  newId,
  quadrantLabelRejection,
  type QuadrantIR,
  type QuadrantPointId,
} from "@gmermaid/ir";
import { layoutQuadrant, plotToQuadrant } from "@gmermaid/layout";
import { quadrantToMermaid } from "@gmermaid/mermaid-codegen";
import { parseQuadrant } from "@gmermaid/mermaid-parser";
import { QuadrantView } from "@gmermaid/renderer";
import { measurer } from "./measurer";
import { loadInitial, openMmd, saveMmd, useAutosave, useLoadWarnings } from "./persistence";
import { CodePane } from "./CodePane";
import { ErrorBoundary } from "./ErrorBoundary";
import { QuadrantChartWindow, QuadrantPointWindow } from "./QuadrantPropertyWindow";
import { SelectionOverlay } from "./SelectionUI";
import { EditorToolbar, DeleteButton } from "./EditorToolbar";
import { useDiagramHistory } from "./useDiagramHistory";
import { useEditorShell } from "./useEditorShell";
import { withSelected } from "./viewSelection";
import type { EditorRuntimeProps } from "./editorRuntime";

function initialIR(): QuadrantIR {
  const sample = `quadrantChart
  title Reach and engagement of campaigns
  x-axis Low Reach --> High Reach
  y-axis Low Engagement --> High Engagement
  quadrant-1 We should expand
  quadrant-2 Need to promote
  quadrant-3 Re-evaluate
  quadrant-4 May be improved
  Campaign A: [0.3, 0.6]
  Campaign B: [0.45, 0.23]
  Campaign C: [0.57, 0.69]
  Campaign D: [0.78, 0.34]
  Campaign E: [0.40, 0.34]
  Campaign F: [0.35, 0.78]
`;
  const parsed = parseQuadrant(sample);
  return parsed.ok ? parsed.ir : emptyQuadrant();
}

// ViewState: transient UI state, never part of the IR (ADR 0001).
interface ViewState {
  readonly selectedId?: string;
}

/** A point being dragged: where it WOULD land, in data coordinates. Nothing
 * reaches the IR (or the undo history) until the pointer is released. */
interface PointDrag {
  readonly id: QuadrantPointId;
  readonly x: number;
  readonly y: number;
}

const STORAGE_KEY = "gmermaid:doc:quadrant";

export interface EditorProps extends EditorRuntimeProps {
  readonly loadRequest?: { readonly seq: number; readonly code: string | null } | undefined;
}

export function QuadrantEditor({ loadRequest, initialCode, mode = "standalone", onCodeChange, onValidityChange }: EditorProps) {
  // recoveredText: stored data that stopped parsing, poured into the code
  // pane as a broken draft for manual repair (S1-3)
  const [initial] = useState(() => {
    if (initialCode === undefined) return loadInitial(STORAGE_KEY, parseQuadrant, initialIR);
    const parsed = parseQuadrant(initialCode);
    return parsed.ok ? { ir: parsed.ir, warnings: parsed.warnings } : { ir: initialIR(), recoveredText: initialCode, warnings: [] };
  });
  const load = useLoadWarnings(initial.warnings);
  const h = useDiagramHistory(() => initial.ir, applyQuadrantAction);
  const [view, setView] = useState<ViewState>({});
  const [drag, setDrag] = useState<PointDrag | undefined>(undefined);
  // reducer rejections must be visible, not silent no-ops (L2)
  const [rejectHint, setRejectHint] = useState<string | undefined>(undefined);
  const ir = h.ir;

  // while a point is dragged the chart shows it where it would land; the IR,
  // the code and the history only change on release
  const shown = useMemo(
    () => (drag === undefined ? ir : applyQuadrantAction(ir, { type: "movePoint", id: drag.id, x: drag.x, y: drag.y })),
    [ir, drag],
  );
  const layout = useMemo(() => layoutQuadrant(shown, measurer), [shown]);
  const code = useMemo(() => quadrantToMermaid(ir), [ir]);
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
      const loaded = load.accept(parseQuadrant(loadRequest.code), "Cannot load stored diagram");
      if (loaded !== undefined) h.pushIR(loaded);
    }
    setView({});
    setDrag(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRequest?.seq]);

  async function openFile() {
    const text = await openMmd();
    if (text === null) return;
    const opened = load.accept(parseQuadrant(text), "Cannot open file");
    if (opened === undefined) return;
    shell.fitOnNextLayout();
    h.pushIR(opened);
    setView({});
  }

  const selected = ir.points.find((p) => p.id === view.selectedId);

  /** `Point 1`, `Point 2`, … skipping names already in use. */
  function uniqueLabel(): string {
    const taken = ir.points.map((p) => p.label);
    let n = 1;
    while (taken.includes(`Point ${n}`)) n += 1;
    return `Point ${n}`;
  }

  /** The middle of the chart, nudged along the diagonal until free — a new
   * point must not hide exactly behind another. */
  function freeSpot(): { x: number; y: number } {
    let at = 0.5;
    while (ir.points.some((p) => p.x === at && p.y === at) && at < 0.95) at = Math.round((at + 0.05) * 100) / 100;
    return { x: at, y: at };
  }

  function addPoint() {
    const id: QuadrantPointId = newId("quadrantPoint");
    h.dispatch({ type: "addPoint", point: { id, label: uniqueLabel(), ...freeSpot() } });
    setRejectHint(undefined);
    setView({ selectedId: id });
  }

  /** A whole selection leaves as ONE undo step: the shared txn key coalesces
   * the dispatches into a single history entry. */
  function deleteSelected(ids: readonly string[]) {
    if (ids.length === 0) return;
    const txn = `delete:${ids.join(",")}`;
    for (const id of ids) {
      if (ir.points.some((p) => p.id === id)) h.dispatch({ type: "removePoint", id: id as QuadrantPointId }, txn);
    }
    setRejectHint(undefined);
    setView({});
  }

  function handlePointDrag(id: string, px: number, py: number) {
    setDrag({ id: id as QuadrantPointId, ...plotToQuadrant(layout.plot, px, py) });
  }

  function handlePointDrop(id: string, px: number, py: number) {
    setDrag(undefined);
    // the drag IS the edit: the new place is data, written straight to the IR
    h.dispatch({ type: "movePoint", id: id as QuadrantPointId, ...plotToQuadrant(layout.plot, px, py) });
    setRejectHint(undefined);
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
      setDrag(undefined);
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
        file={mode === "standalone" ? { open: openFile, save: () => saveMmd(code, "quadrant.mmd") } : undefined}
        tools={
          <button className="btn" onClick={addPoint}>
            + Point
          </button>
        }
        settings={
          <label className="toolbar-field">
            <span>Title</span>
            <input
              aria-label="Chart title"
              value={ir.title ?? ""}
              onBlur={h.endEdit}
              onChange={(e) => h.dispatch({ type: "setTitle", title: e.target.value }, "quadrant:title")}
            />
          </label>
        }
        selectionActions={<DeleteButton label="Delete point" onClick={() => deleteSelected(shell.selection.ids)} />}
        notice={rejectHint}
        tip="drag a point to change its x and y"
      />
      <div className="canvas" ref={shell.canvasRef}>
        <ErrorBoundary>
          <QuadrantView
            layout={layout}
            viewState={{ selectedId: view.selectedId, selectedIds: shell.selection.ids }}
            select={shell.gestures}
            viewport={shell.viewport}
            onViewportChange={shell.setViewport}
            onElementClick={(id, additive) => {
              if (shell.selection.click(id, additive)) return;
              setRejectHint(undefined);
              setView({ selectedId: id });
            }}
            onBackgroundClick={() => setView({})}
            onPointDrag={handlePointDrag}
            onPointDrop={handlePointDrop}
            onGestureCancel={() => setDrag(undefined)}
          />
        </ErrorBoundary>
        <SelectionOverlay shell={shell} />
        {shell.selection.count <= 1 && selected !== undefined && (
          <QuadrantPointWindow
            point={selected}
            onChangeLabel={(label) => {
              const reason = quadrantLabelRejection(label);
              setRejectHint(reason);
              if (reason === undefined) h.dispatch({ type: "updatePoint", id: selected.id, label }, `qp:${selected.id}:label`);
            }}
            onChangeCoords={(x, y) => h.dispatch({ type: "movePoint", id: selected.id, x, y }, `qp:${selected.id}:xy`)}
            onDelete={() => deleteSelected(shell.selection.ids)}
            onEditStart={() => {}}
            onEditEnd={h.endEdit}
          />
        )}
        {shell.selection.count === 0 && selected === undefined && (
          <QuadrantChartWindow
            ir={ir}
            onAxis={(axis, end, text) => h.dispatch({ type: "setAxis", axis, [end]: text }, `quadrant:${axis}-${end}`)}
            onQuadrantLabel={(index, label) => h.dispatch({ type: "setQuadrantLabel", index, label }, `quadrant:q${index}`)}
            onEditStart={() => {}}
            onEditEnd={h.endEdit}
          />
        )}
      </div>
      <CodePane
        code={code}
        parse={parseQuadrant}
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
