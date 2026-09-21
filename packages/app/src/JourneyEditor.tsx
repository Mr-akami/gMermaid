import { useEffect, useMemo, useState } from "react";
import {
  applyJourneyAction,
  emptyJourney,
  newId,
  type JourneyIR,
  type SectionId,
  type TaskId,
} from "@gmermaid/ir";
import { layoutJourney } from "@gmermaid/layout";
import { journeyToMermaid } from "@gmermaid/mermaid-codegen";
import { parseJourney } from "@gmermaid/mermaid-parser";
import { JourneyView, type Viewport } from "@gmermaid/renderer";
import { measurer } from "./measurer";
import { formatParseErrors, loadInitial, openMmd, saveMmd, useAutosave } from "./persistence";
import { CodePane } from "./CodePane";
import { ErrorBoundary } from "./ErrorBoundary";
import { JourneyPropertyWindow, type JourneySelection } from "./JourneyPropertyWindow";
import { useDiagramHistory } from "./useDiagramHistory";
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
    return parsed.ok ? { ir: parsed.ir } : { ir: initialIR(), recoveredText: initialCode };
  });
  const h = useDiagramHistory(() => initial.ir, applyJourneyAction);
  const [view, setView] = useState<ViewState>({});
  // pan/zoom is ViewState (ADR 0001), held apart from the selection
  const [viewport, setViewport] = useState<Viewport | undefined>(undefined);
  const ir = h.ir;

  const layout = useMemo(() => layoutJourney(ir, measurer), [ir]);
  const code = useMemo(() => journeyToMermaid(ir), [ir]);
  const [codeValid, setCodeValid] = useState(initial.recoveredText === undefined);
  useAutosave(STORAGE_KEY, code, mode === "standalone" && codeValid);
  useEffect(() => onCodeChange?.(code), [code, onCodeChange]);

  useEffect(() => {
    if (!loadRequest) return;
    if (loadRequest.code === null) {
      h.pushIR(initialIR());
    } else {
      const result = parseJourney(loadRequest.code);
      if (result.ok) h.pushIR(result.ir);
      else alert(`Cannot load stored diagram:\n${formatParseErrors(result.errors)}`);
    }
    setView({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRequest?.seq]);

  async function openFile() {
    const text = await openMmd();
    if (text === null) return;
    const result = parseJourney(text);
    if (result.ok) {
      h.pushIR(result.ir);
      setView({});
    } else {
      alert(`Cannot open file:\n${formatParseErrors(result.errors)}`);
    }
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

  function deleteSelected() {
    if (selectedTask) h.dispatch({ type: "removeTask", id: selectedTask.id });
    else if (selectedSection) h.dispatch({ type: "removeSection", id: selectedSection.id });
    setView({});
  }

  return (
    <>
      <div className="toolbar">
        {mode === "standalone" && <button onClick={openFile}>Open…</button>}
        {mode === "standalone" && <button onClick={() => saveMmd(code, "journey.mmd")}>Save…</button>}
        <button onClick={addSection}>+ Section</button>
        <button disabled={targetSection === undefined} onClick={addTask}>
          + Task
        </button>
        <button disabled={selection === undefined} onClick={deleteSelected}>
          Delete
        </button>
        <button onClick={h.undo} disabled={!h.canUndo}>
          Undo
        </button>
        <button onClick={h.redo} disabled={!h.canRedo}>
          Redo
        </button>
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
      <div className="canvas">
        <ErrorBoundary>
          <JourneyView
            layout={layout}
            viewState={{ selectedId: view.selectedId }}
            viewport={viewport}
            onViewportChange={setViewport}
            onElementClick={(id) => setView({ selectedId: id })}
            onBackgroundClick={() => setView({})}
          />
        </ErrorBoundary>
        {selection && (
          <JourneyPropertyWindow
            selection={selection}
            onChangeTaskName={(name) =>
              selectedTask && h.dispatch({ type: "updateTask", id: selectedTask.id, name }, `task:${selectedTask.id}:name`)
            }
            onChangeTaskScore={(score) => selectedTask && h.dispatch({ type: "updateTask", id: selectedTask.id, score })}
            onChangeTaskActors={(actors) =>
              selectedTask && h.dispatch({ type: "updateTask", id: selectedTask.id, actors }, `task:${selectedTask.id}:actors`)
            }
            onChangeSectionName={(name) =>
              selectedSection && h.dispatch({ type: "updateSection", id: selectedSection.id, name }, `section:${selectedSection.id}:name`)
            }
            onMove={move}
            onDelete={deleteSelected}
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
        onValidityChange={(valid) => {
          setCodeValid(valid);
          onValidityChange?.(valid);
        }}
      />
    </>
  );
}
