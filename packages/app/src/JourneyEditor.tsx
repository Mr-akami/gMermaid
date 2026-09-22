import { useEffect, useMemo, useState } from "react";
import {
  applyJourneyAction,
  emptyJourney,
  journeyTaskNameRejection,
  newId,
  type JourneyIR,
  type SectionId,
  type TaskId,
} from "@gmermaid/ir";
import { layoutJourney } from "@gmermaid/layout";
import { journeyToMermaid } from "@gmermaid/mermaid-codegen";
import { parseJourney } from "@gmermaid/mermaid-parser";
import { JourneyView } from "@gmermaid/renderer";
import { measurer } from "./measurer";
import { loadInitial, openMmd, saveMmd, useAutosave, useLoadWarnings } from "./persistence";
import { CodePane } from "./CodePane";
import { ErrorBoundary } from "./ErrorBoundary";
import { JourneyPropertyWindow, type JourneySelection } from "./JourneyPropertyWindow";
import { SelectionOverlay, SelectionTools } from "./SelectionUI";
import { useDiagramHistory } from "./useDiagramHistory";
import { useEditorShell } from "./useEditorShell";
import { withSelected } from "./viewSelection";
import type { EditorRuntimeProps } from "./editorRuntime";

function initialIR(): JourneyIR {
  const sample = `journey
  title Sign up for the service
  section Discover
    Read the docs: 4: Visitor
    Compare plans: 3: Visitor
  section Sign up
    Fill the form: 2: Visitor, Support
    Confirm the email: 3: Visitor
  section First use
    Create a diagram: 5: User
`;
  const parsed = parseJourney(sample);
  return parsed.ok ? parsed.ir : emptyJourney();
}

// ViewState: transient UI state, never part of the IR (ADR 0001).
interface ViewState {
  readonly selectedId?: string;
}

const STORAGE_KEY = "gmermaid:doc:journey";

export interface EditorProps extends EditorRuntimeProps {
  readonly loadRequest?: { readonly seq: number; readonly code: string | null } | undefined;
}

export function JourneyEditor({ loadRequest, initialCode, mode = "standalone", onCodeChange, onValidityChange }: EditorProps) {
  // recoveredText: stored data that stopped parsing, poured into the code
  // pane as a broken draft for manual repair
  const [initial] = useState(() => {
    if (initialCode === undefined) return loadInitial(STORAGE_KEY, parseJourney, initialIR);
    const parsed = parseJourney(initialCode);
    return parsed.ok ? { ir: parsed.ir, warnings: parsed.warnings } : { ir: initialIR(), recoveredText: initialCode, warnings: [] };
  });
  const load = useLoadWarnings(initial.warnings);
  const h = useDiagramHistory(() => initial.ir, applyJourneyAction);
  const [view, setView] = useState<ViewState>({});
  // reducer rejections must be visible, not silent no-ops (L2)
  const [rejectHint, setRejectHint] = useState<string | undefined>(undefined);
  const ir = h.ir;

  const layout = useMemo(() => layoutJourney(ir, measurer), [ir]);
  const code = useMemo(() => journeyToMermaid(ir), [ir]);
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
      const loaded = load.accept(parseJourney(loadRequest.code), "Cannot load stored diagram");
      if (loaded !== undefined) h.pushIR(loaded);
    }
    setView({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRequest?.seq]);

  async function openFile() {
    const text = await openMmd();
    if (text === null) return;
    const opened = load.accept(parseJourney(text), "Cannot open file");
    if (opened === undefined) return;
    shell.fitOnNextLayout();
    h.pushIR(opened);
    setView({});
  }

  const sectionIndex = ir.sections.findIndex((s) => s.tasks.some((t) => t.id === view.selectedId));
  const selectedTask = sectionIndex >= 0 ? ir.sections[sectionIndex]!.tasks.find((t) => t.id === view.selectedId) : undefined;
  const selectedSectionIndex = ir.sections.findIndex((s) => s.id === view.selectedId);
  const selectedSection = selectedSectionIndex >= 0 ? ir.sections[selectedSectionIndex] : undefined;
  /** Where a new task goes: the selected section, or the one holding the
   * selected task, or the last section. */
  const targetSection = selectedSection ?? (sectionIndex >= 0 ? ir.sections[sectionIndex] : ir.sections[ir.sections.length - 1]);

  function addSection() {
    const id = newId("section");
    let n = ir.sections.length + 1;
    while (ir.sections.some((s) => s.name === `Section ${n}`)) n += 1;
    h.dispatch({ type: "addSection", section: { id, name: `Section ${n}` } });
    setView({ selectedId: id });
  }

  function addTask() {
    if (!targetSection) return;
    const id = newId("task");
    let n = 1;
    while (ir.sections.some((s) => s.tasks.some((t) => t.name === `Task ${n}`))) n += 1;
    h.dispatch({
      type: "addTask",
      sectionId: targetSection.id,
      task: { id, name: `Task ${n}`, score: 3, actors: [] },
      ...(selectedTask !== undefined ? { afterTaskId: selectedTask.id } : {}),
    });
    setView({ selectedId: id });
  }

  const selection: JourneySelection | undefined = selectedTask
    ? {
        kind: "task",
        task: selectedTask,
        section: ir.sections[sectionIndex]!,
        canMoveUp: sectionIndex > 0 || ir.sections[sectionIndex]!.tasks[0]!.id !== selectedTask.id,
        canMoveDown:
          sectionIndex < ir.sections.length - 1 ||
          ir.sections[sectionIndex]!.tasks[ir.sections[sectionIndex]!.tasks.length - 1]!.id !== selectedTask.id,
      }
    : selectedSection
      ? {
          kind: "section",
          section: selectedSection,
          canMoveUp: selectedSectionIndex > 0,
          canMoveDown: selectedSectionIndex < ir.sections.length - 1,
        }
      : undefined;

  function move(delta: -1 | 1) {
    if (selectedTask) h.dispatch({ type: "moveTask", id: selectedTask.id as TaskId, delta });
    else if (selectedSection) h.dispatch({ type: "moveSection", id: selectedSection.id as SectionId, delta });
  }

  function removeById(id: string, txn: string) {
    if (ir.sections.some((s) => s.tasks.some((t) => t.id === id))) h.dispatch({ type: "removeTask", id: id as TaskId }, txn);
    else if (ir.sections.some((s) => s.id === id)) h.dispatch({ type: "removeSection", id: id as SectionId }, txn);
  }

  /** A whole selection leaves as ONE undo step: the shared txn key coalesces
   * the dispatches into a single history entry. */
  function deleteSelected(ids: readonly string[]) {
    if (ids.length === 0) return;
    const txn = `delete:${ids.join(",")}`;
    for (const id of ids) removeById(id, txn);
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
    // "move" on a journey is the property window's own earlier/later
    ...(selection !== undefined
      ? {
          moveItems: [
            { label: "↑ 前へ移動", run: () => move(-1) },
            { label: "↓ 後へ移動", run: () => move(1) },
          ],
        }
      : {}),
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
        {mode === "standalone" && <button onClick={() => saveMmd(code, "journey.mmd")}>Save…</button>}
        <button onClick={addSection}>+ Section</button>
        <button disabled={targetSection === undefined} onClick={addTask}>
          + Task
        </button>
        <button disabled={selection === undefined} onClick={() => deleteSelected(shell.selection.ids)}>
          Delete
        </button>
        <button onClick={h.undo} disabled={!h.canUndo}>
          Undo
        </button>
        <button onClick={h.redo} disabled={!h.canRedo}>
          Redo
        </button>
        <button aria-label="Fit view" title="Fit the whole diagram in the canvas" onClick={shell.fitView}>
          ⤢ Fit
        </button>
        <SelectionTools shell={shell} />
        <label className="toolbar-field">
          Title
          <input
            aria-label="Journey title"
            value={ir.title ?? ""}
            onBlur={h.endEdit}
            onChange={(e) => h.dispatch({ type: "setJourneyTitle", title: e.target.value }, "journey:title")}
          />
        </label>
      </div>
      <div className="canvas" ref={shell.canvasRef}>
        <ErrorBoundary>
          <JourneyView
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
          />
        </ErrorBoundary>
        <SelectionOverlay shell={shell} />
        {shell.selection.count <= 1 && selection && (
          <JourneyPropertyWindow
            selection={selection}
            rejectHint={rejectHint}
            onChangeTaskName={(name) => {
              const reason = journeyTaskNameRejection(name);
              setRejectHint(reason);
              if (reason === undefined && selectedTask)
                h.dispatch({ type: "updateTask", id: selectedTask.id, name }, `task:${selectedTask.id}:name`);
            }}
            onChangeTaskScore={(score) => selectedTask && h.dispatch({ type: "updateTask", id: selectedTask.id, score })}
            onChangeTaskActors={(actors) =>
              selectedTask && h.dispatch({ type: "updateTask", id: selectedTask.id, actors }, `task:${selectedTask.id}:actors`)
            }
            onChangeSectionName={(name) =>
              selectedSection && h.dispatch({ type: "updateSection", id: selectedSection.id, name }, `section:${selectedSection.id}:name`)
            }
            onMove={move}
            onDelete={() => deleteSelected(shell.selection.ids)}
            onEditStart={() => {}}
            onEditEnd={h.endEdit}
          />
        )}
      </div>
      <CodePane
        code={code}
        parse={parseJourney}
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
