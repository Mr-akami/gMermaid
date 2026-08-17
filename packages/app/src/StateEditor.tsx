import { useEffect, useMemo, useState } from "react";
import {
  applyStateAction,
  emptyStateDiagram,
  newStateId,
  newId,
  reparentRejection,
  type StateIR,
  type StateId,
} from "@gmermaid/ir";
import { layoutStateDiagram } from "@gmermaid/layout";
import { stateToMermaid } from "@gmermaid/mermaid-codegen";
import { parseStateDiagram } from "@gmermaid/mermaid-parser";
import { StateView, type Viewport } from "@gmermaid/renderer";
import { measurer } from "./measurer";
import { formatParseErrors, loadInitial, openMmd, saveMmd, useAutosave } from "./persistence";
import { CodePane } from "./CodePane";
import { ErrorBoundary } from "./ErrorBoundary";
import { StatePropertyWindow, type StateSelection } from "./StatePropertyWindow";
import { useDiagramHistory } from "./useDiagramHistory";
import type { EditorRuntimeProps } from "./editorRuntime";

function initialIR(): StateIR {
  const sample = `stateDiagram-v2
  [*] --> Still
  Still --> Moving : push
  state Moving {
    [*] --> Slow
    Slow --> Fast : accelerate
  }
  Moving --> Crash : collision
  Crash --> [*]
  note right of Crash : investigate!
`;
  const parsed = parseStateDiagram(sample);
  return parsed.ok ? parsed.ir : emptyStateDiagram();
}

// ViewState: transient UI state, never part of the IR (ADR 0001).
interface ViewState {
  readonly selectedId?: string;
  readonly transitionFrom?: StateId;
  /** Composite membership picker: the state waiting for its new parent.
   * Click-based (like transitionFrom) — a drag gesture would collide with
   * drag-to-connect, which every state already owns. */
  readonly moveInto?: StateId;
}

const STORAGE_KEY = "gmermaid:doc:state";

export interface EditorProps extends EditorRuntimeProps {
  readonly loadRequest?: { readonly seq: number; readonly code: string | null } | undefined;
}

export function StateEditor({ loadRequest, initialCode, mode = "standalone", onCodeChange, onValidityChange }: EditorProps) {
  // recoveredText: stored data that stopped parsing, poured into the code
  // pane as a broken draft for manual repair (S1-3)
  const [initial] = useState(() => {
    if (initialCode === undefined) return loadInitial(STORAGE_KEY, parseStateDiagram, initialIR);
    const parsed = parseStateDiagram(initialCode);
    return parsed.ok ? { ir: parsed.ir } : { ir: initialIR(), recoveredText: initialCode };
  });
  const h = useDiagramHistory(() => initial.ir, applyStateAction);
  const [view, setView] = useState<ViewState>({});
  // pan/zoom is ViewState (ADR 0001), held apart from the selection
  const [viewport, setViewport] = useState<Viewport | undefined>(undefined);
  // drag-to-connect rubber band: view-transient (ADR 0001)
  const [connectLine, setConnectLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | undefined>(undefined);
  const ir = h.ir;

  const layout = useMemo(() => layoutStateDiagram(ir, measurer), [ir]);
  const code = useMemo(() => stateToMermaid(ir), [ir]);
  // autosave pauses while the code pane shows a broken/stale draft, so a
  // recovered draft is never clobbered by the sample it fell back to
  const [codeValid, setCodeValid] = useState(initial.recoveredText === undefined);
  useAutosave(STORAGE_KEY, code, mode === "standalone" && codeValid);
  useEffect(() => onCodeChange?.(code), [code, onCodeChange]);

  useEffect(() => {
    if (!loadRequest) return;
    if (loadRequest.code === null) {
      h.pushIR(initialIR());
    } else {
      const result = parseStateDiagram(loadRequest.code);
      if (result.ok) h.pushIR(result.ir);
      else alert(`Cannot load stored diagram:\n${formatParseErrors(result.errors)}`);
    }
    setView({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRequest?.seq]);

  async function openFile() {
    const text = await openMmd();
    if (text === null) return;
    const result = parseStateDiagram(text);
    if (result.ok) {
      h.pushIR(result.ir);
      setView({});
    } else {
      alert(`Cannot open file:\n${formatParseErrors(result.errors)}`);
    }
  }

  function addState() {
    const id = newStateId();
    let n = 1;
    while (ir.states.some((s) => s.label === `NewState${n}`)) n += 1;
    h.dispatch({ type: "addState", state: { id, label: `NewState${n}`, role: "normal" } });
    setView({ selectedId: id });
  }

  function addPseudo(role: "start" | "end") {
    const existing = ir.states.find((s) => s.role === role);
    if (existing) {
      setView({ selectedId: existing.id });
      return;
    }
    const id = newStateId();
    h.dispatch({ type: "addState", state: { id, label: "", role } });
    setView({ selectedId: id });
  }

  function addSpecial(role: "choice" | "fork" | "join") {
    const id = newStateId();
    h.dispatch({ type: "addState", state: { id, label: "", role } });
    setView({ selectedId: id });
  }

  function addNote() {
    if (!selectedState) return;
    const id = newId("note");
    h.dispatch({ type: "addStateNote", note: { id, target: selectedState.id, position: "rightOf", text: "note" } });
    setView({ selectedId: id });
  }

  const selectedState = ir.states.find((s) => s.id === view.selectedId);
  const selectedTransition = ir.transitions.find((t) => t.id === view.selectedId);
  const selectedNote = ir.notes.find((n) => n.id === view.selectedId);
  const selection: StateSelection | undefined = selectedState
    ? { kind: "state", state: selectedState }
    : selectedTransition
      ? { kind: "transition", transition: selectedTransition }
      : selectedNote
        ? { kind: "note", note: selectedNote }
        : undefined;

  function connect(fromId: StateId, toId: StateId) {
    const transId = newId("transition");
    h.dispatch({ type: "addTransition", transition: { id: transId, from: fromId, to: toId } });
    setView({ selectedId: transId });
  }

  function handleConnectDrag(fromId: string, x: number, y: number) {
    const from = layout.states.find((s) => s.id === fromId);
    if (from) setConnectLine({ x1: from.rect.x + from.rect.w / 2, y1: from.rect.y + from.rect.h / 2, x2: x, y2: y });
  }

  function handleConnectDrop(fromId: string, x: number, y: number) {
    setConnectLine(undefined);
    const from = ir.states.find((s) => s.id === fromId);
    const target = layout.states.find(
      (s) => s.id !== fromId && x >= s.rect.x && x <= s.rect.x + s.rect.w && y >= s.rect.y && y <= s.rect.y + s.rect.h,
    );
    if (!from || !target) return;
    connect(from.id, target.id as StateId);
  }

  // reducer rejections must be visible, not silent no-ops (L2)
  const [rejectHint, setRejectHint] = useState<string | undefined>(undefined);

  function moveInto(id: StateId, parent: StateId | null) {
    const reason = reparentRejection(ir, id, parent);
    if (reason !== undefined) {
      setRejectHint(reason);
      setView({ selectedId: id });
      return;
    }
    setRejectHint(undefined);
    h.dispatch({ type: "setStateParent", id, parent });
    setView({ selectedId: id });
  }

  function handleElementClick(id: string) {
    const target = ir.states.find((s) => s.id === id);
    if (view.moveInto !== undefined && target) {
      moveInto(view.moveInto, target.id);
      return;
    }
    if (view.transitionFrom !== undefined && target && target.id !== view.transitionFrom) {
      connect(view.transitionFrom, target.id);
      return;
    }
    setView({ selectedId: id });
  }

  function handleBackgroundClick() {
    // in move mode the background means "take it out to the top level"
    if (view.moveInto !== undefined) {
      moveInto(view.moveInto, null);
      return;
    }
    setView({});
  }

  return (
    <>
      <div className="toolbar">
        {mode === "standalone" && <button onClick={openFile}>Open…</button>}
        {mode === "standalone" && <button onClick={() => saveMmd(code, "state.mmd")}>Save…</button>}
        <button onClick={addState}>+ State</button>
        <button onClick={() => addPseudo("start")}>+ Start [*]</button>
        <button onClick={() => addPseudo("end")}>+ End [*]</button>
        <button onClick={() => addSpecial("choice")}>+ Choice</button>
        <button onClick={() => addSpecial("fork")}>+ Fork</button>
        <button onClick={() => addSpecial("join")}>+ Join</button>
        <button disabled={selectedState === undefined} onClick={addNote}>+ Note</button>
        <button
          disabled={selectedState === undefined}
          onClick={() => selectedState && setView({ ...view, transitionFrom: selectedState.id })}
        >
          → Transition from selected
        </button>
        <button
          disabled={selectedState === undefined}
          onClick={() => selectedState && setView({ selectedId: selectedState.id, moveInto: selectedState.id })}
        >
          ⊂ Move into…
        </button>
        <button onClick={h.undo} disabled={!h.canUndo}>Undo</button>
        <button onClick={h.redo} disabled={!h.canRedo}>Redo</button>
        <select
          value={ir.direction ?? "TB"}
          onChange={(e) => h.dispatch({ type: "setDirection", direction: e.target.value as NonNullable<StateIR["direction"]> })}
        >
          <option value="TB">Top→Bottom</option>
          <option value="LR">Left→Right</option>
          <option value="BT">Bottom→Top</option>
          <option value="RL">Right→Left</option>
        </select>
        {view.transitionFrom !== undefined && <span className="hint">click a target state…</span>}
        {view.moveInto !== undefined && <span className="hint">click the container state (background = top level)…</span>}
        {rejectHint !== undefined && <span className="hint">{rejectHint}</span>}
      </div>
      <div className="canvas">
        <ErrorBoundary>
          <StateView
            layout={layout}
            viewState={{ selectedId: view.selectedId }}
            viewport={viewport}
            onViewportChange={setViewport}
            onElementClick={handleElementClick}
            onBackgroundClick={handleBackgroundClick}
            onConnectDrag={handleConnectDrag}
            onConnectDrop={handleConnectDrop}
            connectLine={connectLine}
            onGestureCancel={() => setConnectLine(undefined)}
          />
        </ErrorBoundary>
        {selection && (
          <StatePropertyWindow
            selection={selection}
            onChangeStateLabel={(label) =>
              selectedState && h.dispatch({ type: "updateState", id: selectedState.id, label }, `state:${selectedState.id}:label`)
            }
            onChangeTransitionLabel={(label) =>
              selectedTransition &&
              h.dispatch({ type: "updateTransition", id: selectedTransition.id, label }, `trans:${selectedTransition.id}:label`)
            }
            onChangeNoteText={(text) =>
              selectedNote && h.dispatch({ type: "updateStateNote", id: selectedNote.id, text }, `snote:${selectedNote.id}:text`)
            }
            onChangeNotePosition={(position) =>
              selectedNote && h.dispatch({ type: "updateStateNote", id: selectedNote.id, position })
            }
            onDelete={() => {
              if (selectedState) h.dispatch({ type: "removeState", id: selectedState.id });
              if (selectedTransition) h.dispatch({ type: "removeTransition", id: selectedTransition.id });
              if (selectedNote) h.dispatch({ type: "removeStateNote", id: selectedNote.id });
              setView({});
            }}
            onEditStart={() => {}}
            onEditEnd={h.endEdit}
          />
        )}
      </div>
      <CodePane
        code={code}
        parse={parseStateDiagram}
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
