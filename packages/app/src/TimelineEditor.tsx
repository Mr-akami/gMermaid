import { useEffect, useMemo, useState } from "react";
import {
  applyTimelineAction,
  emptyTimeline,
  newId,
  periodOfEvent,
  sectionOfPeriod,
  timelineTextRejection,
  timelineTitleRejection,
  type EventId,
  type PeriodId,
  type SectionId,
  type TimelineIR,
} from "@gmermaid/ir";
import { layoutTimeline } from "@gmermaid/layout";
import { timelineToMermaid } from "@gmermaid/mermaid-codegen";
import { parseTimeline } from "@gmermaid/mermaid-parser";
import { TimelineView } from "@gmermaid/renderer";
import { measurer } from "./measurer";
import { loadInitial, openMmd, saveMmd, useAutosave, useLoadWarnings } from "./persistence";
import { CodePane } from "./CodePane";
import { ErrorBoundary } from "./ErrorBoundary";
import { TimelinePropertyWindow, type TimelineSelection } from "./TimelinePropertyWindow";
import { SelectionOverlay, SelectionTools } from "./SelectionUI";
import { useDiagramHistory } from "./useDiagramHistory";
import { useEditorShell } from "./useEditorShell";
import { withSelected } from "./viewSelection";
import type { EditorRuntimeProps } from "./editorRuntime";

function initialIR(): TimelineIR {
  const sample = `timeline
  title History of Social Media Platform
  2002 : LinkedIn
  2004 : Facebook : Google
  2005 : YouTube
  2006 : Twitter
`;
  const parsed = parseTimeline(sample);
  return parsed.ok ? parsed.ir : emptyTimeline();
}

// ViewState: transient UI state, never part of the IR (ADR 0001).
interface ViewState {
  readonly selectedId?: string;
}

/** `Stem1`, `Stem2`, … skipping names already in use. */
function uniqueName(taken: readonly string[], stem: string): string {
  let n = 1;
  while (taken.includes(`${stem}${n}`)) n += 1;
  return `${stem}${n}`;
}

const STORAGE_KEY = "gmermaid:doc:timeline";

export interface EditorProps extends EditorRuntimeProps {
  readonly loadRequest?: { readonly seq: number; readonly code: string | null } | undefined;
}

export function TimelineEditor({ loadRequest, initialCode, mode = "standalone", onCodeChange, onValidityChange }: EditorProps) {
  // recoveredText: stored data that stopped parsing, poured into the code
  // pane as a broken draft for manual repair (S1-3)
  const [initial] = useState(() => {
    if (initialCode === undefined) return loadInitial(STORAGE_KEY, parseTimeline, initialIR);
    const parsed = parseTimeline(initialCode);
    return parsed.ok ? { ir: parsed.ir, warnings: parsed.warnings } : { ir: initialIR(), recoveredText: initialCode, warnings: [] };
  });
  const load = useLoadWarnings(initial.warnings);
  const h = useDiagramHistory(() => initial.ir, applyTimelineAction);
  const [view, setView] = useState<ViewState>({});
  // reducer rejections must be visible, not silent no-ops (L2)
  const [rejectHint, setRejectHint] = useState<string | undefined>(undefined);
  const [titleHint, setTitleHint] = useState<string | undefined>(undefined);
  const ir = h.ir;

  const layout = useMemo(() => layoutTimeline(ir, measurer), [ir]);
  const code = useMemo(() => timelineToMermaid(ir), [ir]);
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
      const loaded = load.accept(parseTimeline(loadRequest.code), "Cannot load stored diagram");
      if (loaded !== undefined) h.pushIR(loaded);
    }
    setView({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRequest?.seq]);

  async function openFile() {
    const text = await openMmd();
    if (text === null) return;
    const opened = load.accept(parseTimeline(text), "Cannot open file");
    if (opened === undefined) return;
    shell.fitOnNextLayout();
    h.pushIR(opened);
    setView({});
  }

  const selectedSection = ir.sections.find((s) => s.id === view.selectedId);
  const selectedPeriod = ir.sections.flatMap((s) => s.periods).find((p) => p.id === view.selectedId);
  const selectedEvent = ir.sections.flatMap((s) => s.periods).flatMap((p) => p.events).find((e) => e.id === view.selectedId);

  /** Where a new period goes: the selected section, else the section holding
   * the selection, else the last one. */
  const targetSection: SectionId | undefined =
    selectedSection?.id ??
    (selectedPeriod && sectionOfPeriod(ir, selectedPeriod.id)?.id) ??
    (selectedEvent && sectionOfPeriod(ir, periodOfEvent(ir, selectedEvent.id)!.id)?.id) ??
    ir.sections[ir.sections.length - 1]?.id;

  const targetPeriod: PeriodId | undefined =
    selectedPeriod?.id ?? (selectedEvent && periodOfEvent(ir, selectedEvent.id)?.id);

  function addSection() {
    const id = newId("section");
    const name = uniqueName(ir.sections.map((s) => s.name), "Section ");
    h.dispatch({ type: "addSection", section: { id, name, periods: [] } });
    setRejectHint(undefined);
    setView({ selectedId: id });
  }

  function addPeriod() {
    let sectionId = targetSection;
    if (sectionId === undefined) {
      // a timeline with no section at all: open the unnamed leading group
      sectionId = newId("section");
      h.dispatch({ type: "addSection", section: { id: sectionId, name: "", periods: [] } });
    }
    const id = newId("period");
    const taken = ir.sections.flatMap((s) => s.periods).map((p) => p.label);
    h.dispatch({ type: "addPeriod", sectionId, period: { id, label: uniqueName(taken, "Period "), events: [] } });
    setRejectHint(undefined);
    setView({ selectedId: id });
  }

  function addEvent() {
    if (targetPeriod === undefined) return;
    const id: EventId = newId("event");
    const taken = ir.sections.flatMap((s) => s.periods).flatMap((p) => p.events).map((e) => e.text);
    h.dispatch({ type: "addEvent", periodId: targetPeriod, event: { id, text: uniqueName(taken, "Event ") } });
    setRejectHint(undefined);
    setView({ selectedId: id });
  }

  function removeById(id: string, txn: string) {
    const periods = ir.sections.flatMap((s) => s.periods);
    if (ir.sections.some((s) => s.id === id)) h.dispatch({ type: "removeSection", id: id as SectionId }, txn);
    else if (periods.some((p) => p.id === id)) h.dispatch({ type: "removePeriod", id: id as PeriodId }, txn);
    else if (periods.some((p) => p.events.some((e) => e.id === id))) h.dispatch({ type: "removeEvent", id: id as EventId }, txn);
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

  /** The property window's ↑ ↓, shared with the context menu. */
  function moveSelected(delta: -1 | 1) {
    if (selectedPeriod) h.dispatch({ type: "movePeriod", id: selectedPeriod.id, delta });
    if (selectedEvent) h.dispatch({ type: "moveEvent", id: selectedEvent.id, delta });
  }

  /** Text edits the reducer would silently drop get a visible reason. */
  function guardText(text: string, run: () => void) {
    const reason = timelineTextRejection(text);
    setRejectHint(reason);
    if (reason === undefined) run();
  }

  const selection: TimelineSelection | undefined = selectedSection
    ? { kind: "section", section: selectedSection }
    : selectedPeriod
      ? { kind: "period", period: selectedPeriod }
      : selectedEvent
        ? { kind: "event", event: selectedEvent }
        : undefined;

  const shell = useEditorShell({
    ir,
    layout,
    selectedId: view.selectedId,
    select: (id) => setView((v) => withSelected(v, id)),
    onDelete: deleteSelected,
    onPaste: (next) => h.pushIR(next),
    notify: setRejectHint,
    // "move" on a timeline is the property window's own ↑ ↓ reordering
    ...(selectedPeriod !== undefined || selectedEvent !== undefined
      ? {
          moveItems: [
            { label: "↑ 上へ移動", run: () => moveSelected(-1) },
            { label: "↓ 下へ移動", run: () => moveSelected(1) },
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
        {mode === "standalone" && <button onClick={() => saveMmd(code, "timeline.mmd")}>Save…</button>}
        <button onClick={addSection}>+ Section</button>
        <button onClick={addPeriod}>+ Period</button>
        <button disabled={targetPeriod === undefined} onClick={addEvent}>+ Event</button>
        <button disabled={selection === undefined} onClick={() => deleteSelected(shell.selection.ids)}>Delete</button>
        <button onClick={h.undo} disabled={!h.canUndo}>Undo</button>
        <button onClick={h.redo} disabled={!h.canRedo}>Redo</button>
        <button aria-label="Fit view" title="Fit the whole diagram in the canvas" onClick={shell.fitView}>
          ⤢ Fit
        </button>
        <SelectionTools shell={shell} />
        <label className="toolbar-field">
          Timeline title
          <input
            value={ir.title ?? ""}
            onFocus={() => {}}
            onBlur={h.endEdit}
            onChange={(e) => {
              const reason = timelineTitleRejection(e.target.value);
              setTitleHint(reason);
              if (reason === undefined) h.dispatch({ type: "setTitle", title: e.target.value }, "timeline:title");
            }}
          />
        </label>
        {titleHint !== undefined && <span className="hint">{titleHint}</span>}
      </div>
      <div className="canvas" ref={shell.canvasRef}>
        <ErrorBoundary>
          <TimelineView
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
          />
        </ErrorBoundary>
        <SelectionOverlay shell={shell} />
        {shell.selection.count <= 1 && selection && (
          <TimelinePropertyWindow
            selection={selection}
            rejectHint={rejectHint}
            onChangeSectionName={(name) =>
              selectedSection &&
              guardText(name, () =>
                h.dispatch({ type: "updateSection", id: selectedSection.id, name }, `section:${selectedSection.id}:name`),
              )
            }
            onChangePeriodLabel={(label) =>
              selectedPeriod &&
              guardText(label, () =>
                h.dispatch({ type: "updatePeriod", id: selectedPeriod.id, label }, `period:${selectedPeriod.id}:label`),
              )
            }
            onChangeEventText={(text) =>
              selectedEvent &&
              guardText(text, () =>
                h.dispatch({ type: "updateEvent", id: selectedEvent.id, text }, `event:${selectedEvent.id}:text`),
              )
            }
            onMove={moveSelected}
            onDelete={() => deleteSelected(shell.selection.ids)}
            onEditStart={() => {}}
            onEditEnd={h.endEdit}
          />
        )}
      </div>
      <CodePane
        code={code}
        parse={parseTimeline}
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
