import { useEffect, useMemo, useState } from "react";
import {
  applyStateAction,
  emptyStateDiagram,
  mergeMermaidDetail,
  mergeXStateDetail,
  newStateId,
  newId,
  reparentRejection,
  stateNoteRejection,
  stateRegionCount,
  transitionRetargetRejection,
  type NoteId,
  type StateIR,
  type StateId,
  type StateNode,
  type TransitionId,
} from "@gmermaid/ir";
import { layoutStateDiagram } from "@gmermaid/layout";
import { stateToMermaid } from "@gmermaid/mermaid-codegen";
import { parseStateDiagram } from "@gmermaid/mermaid-parser";
import { parseXStateMachine, stateToXState, XSTATE_SUBSET } from "@gmermaid/xstate";
import { StateView } from "@gmermaid/renderer";
import { measurer } from "./measurer";
import { loadInitial, openMmd, readStoredCode, saveMmd, useAutosave, useLoadWarnings } from "./persistence";
import { CodeTabs } from "./CodeTabs";
import { ErrorBoundary } from "./ErrorBoundary";
import { StatePropertyWindow, type StateSelection } from "./StatePropertyWindow";
import { SelectionOverlay, SelectionTools } from "./SelectionUI";
import { useDiagramHistory } from "./useDiagramHistory";
import { useEditorShell } from "./useEditorShell";
import { withSelected } from "./viewSelection";
import type { EditorRuntimeProps } from "./editorRuntime";

function initialIR(): StateIR {
  const sample = `stateDiagram-v2
  [*] --> Still
  Still --> Moving : push
  state Moving {
    direction LR
    [*] --> Slow
    Slow --> Fast : accelerate
    --
    state Wipers
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
  /** Move mode re-points the ONE drag gesture a state owns: instead of
   * drawing a transition, dragging drops the state into the composite frame
   * under the pointer. A modifier key would be cheaper, but the shared
   * pointer hook resolves the gesture from `data-drag` alone. */
  readonly moveMode?: boolean;
}

const STORAGE_KEY = "gmermaid:doc:state";
/** The XState detail of the autosaved diagram, kept BESIDE the `.mmd` text
 * because mermaid has no syntax for it: without this, a page reload would
 * quietly delete every entry action and invocation in the document. Not under
 * `gmermaid:doc:` — it is not a diagram, and the Files panel lists that
 * namespace. */
const XSTATE_KEY = "gmermaid-xstate:doc:state";

/** Fold the XState detail of the autosaved machine back onto the diagram the
 * mermaid autosave restored. The mermaid text stays the structural truth; the
 * sidecar only re-attaches what it could not spell. */
function withStoredXState(ir: StateIR): StateIR {
  try {
    const raw = localStorage.getItem(XSTATE_KEY);
    if (raw === null) return ir;
    const parsed = parseXStateMachine(readStoredCode(raw).code);
    return parsed.ok ? mergeXStateDetail(parsed.ir, ir) : ir;
  } catch {
    return ir; // storage unavailable, or a sidecar from an older grammar
  }
}

export interface EditorProps extends EditorRuntimeProps {
  readonly loadRequest?: { readonly seq: number; readonly code: string | null } | undefined;
}

export function StateEditor({ loadRequest, initialCode, mode = "standalone", onCodeChange, onValidityChange }: EditorProps) {
  // recoveredText: stored data that stopped parsing, poured into the code
  // pane as a broken draft for manual repair (S1-3)
  const [initial] = useState(() => {
    if (initialCode === undefined) {
      const restored = loadInitial(STORAGE_KEY, parseStateDiagram, initialIR);
      return { ...restored, ir: withStoredXState(restored.ir) };
    }
    const parsed = parseStateDiagram(initialCode);
    return parsed.ok ? { ir: parsed.ir, warnings: parsed.warnings } : { ir: initialIR(), recoveredText: initialCode, warnings: [] };
  });
  const load = useLoadWarnings(initial.warnings);
  const h = useDiagramHistory(() => initial.ir, applyStateAction);
  const [view, setView] = useState<ViewState>({});
  // drag-to-connect rubber band: view-transient (ADR 0001)
  const [connectLine, setConnectLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | undefined>(undefined);
  const ir = h.ir;

  const layout = useMemo(() => layoutStateDiagram(ir, measurer), [ir]);
  const code = useMemo(() => stateToMermaid(ir), [ir]);
  // the second projection of the same IR (ADR 0002) — never a second master
  const machine = useMemo(() => stateToXState(ir), [ir]);
  // autosave pauses while EITHER code pane shows a broken/stale draft, so a
  // recovered draft is never clobbered by the sample it fell back to
  const [mermaidValid, setMermaidValid] = useState(initial.recoveredText === undefined);
  const [machineValid, setMachineValid] = useState(true);
  const codeValid = mermaidValid && machineValid;
  useAutosave(STORAGE_KEY, code, mode === "standalone" && codeValid);
  useAutosave(XSTATE_KEY, machine.code, mode === "standalone" && codeValid);
  // autosave follows OUR parsers alone: a diagram the IR already holds is real
  // work, and must keep being saved even while mermaid.js refuses its text.
  // Mermaid.js's verdict travels separately, and only gates the review submit.
  const [mermaidJsValid, setMermaidJsValid] = useState(true);
  useEffect(() => onCodeChange?.(code), [code, onCodeChange]);
  useEffect(() => onValidityChange?.(codeValid && mermaidJsValid), [codeValid, mermaidJsValid, onValidityChange]);

  useEffect(() => {
    if (!loadRequest) return;
    // a REPLACED diagram is framed afresh; an edit never moves the camera
    shell.fitOnNextLayout();
    if (loadRequest.code === null) {
      h.pushIR(initialIR());
    } else {
      const loaded = load.accept(parseStateDiagram(loadRequest.code), "Cannot load stored diagram");
      if (loaded !== undefined) h.pushIR(loaded);
    }
    setView({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRequest?.seq]);

  async function openFile() {
    const text = await openMmd();
    if (text === null) return;
    const opened = load.accept(parseStateDiagram(text), "Cannot open file");
    if (opened === undefined) return;
    shell.fitOnNextLayout();
    h.pushIR(opened);
    setView({});
  }

  /** Where a new element belongs: the container the selection sits in, so
   * building inside a composite does not throw the new state to the top
   * level. A composite selected directly means "inside it"; anything else
   * means "beside it". */
  function isComposite(id: string | undefined): boolean {
    return id !== undefined && ir.states.some((s) => s.parent === id);
  }

  function containerFor(inside: boolean): { parent?: StateId; region: number } {
    const sel = ir.states.find((s) => s.id === view.selectedId);
    if (!sel) return { region: 0 };
    if (inside) return { parent: sel.id, region: 0 };
    return { ...(sel.parent !== undefined ? { parent: sel.parent } : {}), region: sel.region ?? 0 };
  }

  function place(role: StateNode["role"], label: string, inside: boolean) {
    const id = newStateId();
    const { parent, region } = containerFor(inside);
    h.dispatch({
      type: "addState",
      state: { id, label, role, ...(parent !== undefined ? { parent } : {}), ...(region !== 0 ? { region } : {}) },
    });
    setView({ selectedId: id });
  }

  function nextStateLabel(): string {
    let n = 1;
    while (ir.states.some((s) => s.label === `NewState${n}`)) n += 1;
    return `NewState${n}`;
  }

  /** A composite adopts what you add while it is selected, the way a
   * selected subgraph does in the flowchart editor. */
  function addState() {
    setRejectHint(undefined);
    place("normal", nextStateLabel(), isComposite(view.selectedId));
  }

  /** Nest a state inside the selected one — the only way to turn a plain
   * state into a composite, since a composite IS a state with children. */
  function addChildState() {
    if (childRejection !== undefined) {
      setRejectHint(childRejection);
      return;
    }
    setRejectHint(undefined);
    place("normal", nextStateLabel(), true);
  }

  function addPseudo(role: "start" | "end") {
    const reason = pseudoRejection(role);
    if (reason !== undefined) {
      setRejectHint(reason);
      const { parent, region } = containerFor(isComposite(view.selectedId));
      const existing = ir.states.find(
        (s) => s.role === role && s.parent === parent && (s.region ?? 0) === region,
      );
      if (existing) setView({ selectedId: existing.id });
      return;
    }
    setRejectHint(undefined);
    place(role, "", isComposite(view.selectedId));
  }

  function addSpecial(role: "choice" | "fork" | "join") {
    setRejectHint(undefined);
    place(role, "", isComposite(view.selectedId));
  }

  function addNote() {
    if (!selectedState || noteRejection !== undefined) return;
    const id = newId("note");
    h.dispatch({ type: "addStateNote", note: { id, target: selectedState.id, position: "rightOf", text: "note" } });
    setView({ selectedId: id });
  }

  const selectedState = ir.states.find((s) => s.id === view.selectedId);
  const noteRejection = selectedState ? stateNoteRejection(selectedState) : undefined;
  // a composite is a state with children, so only a normal state can take one
  const childRejection =
    selectedState === undefined
      ? "select the state that should contain it"
      : selectedState.role !== "normal"
        ? "only a normal state can contain states"
        : undefined;
  /** `[*]` is scoped per container region, so the button is only blocked
   * when THIS region already has one — not when the diagram does. */
  function pseudoRejection(role: "start" | "end"): string | undefined {
    const { parent, region } = containerFor(isComposite(view.selectedId));
    return ir.states.some((s) => s.role === role && s.parent === parent && (s.region ?? 0) === region)
      ? `this ${parent === undefined ? "diagram" : "region"} already has a ${role} [*]`
      : undefined;
  }
  const selectedTransition = ir.transitions.find((t) => t.id === view.selectedId);
  const selectedNote = ir.notes.find((n) => n.id === view.selectedId);
  const selection: StateSelection | undefined = selectedState
    ? {
        kind: "state",
        state: selectedState,
        parentRegions: selectedState.parent !== undefined ? stateRegionCount(ir, selectedState.parent) : 0,
        composite: ir.states.some((s) => s.parent === selectedState.id),
      }
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
    // a self-transition is legal (`A --> A : tick`), so the source is a
    // valid drop target too — smallest box under the pointer wins
    const target = layout.states
      .filter((s) => x >= s.rect.x && x <= s.rect.x + s.rect.w && y >= s.rect.y && y <= s.rect.y + s.rect.h)
      .toSorted((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)[0];
    if (!from || !target) return;
    connect(from.id, target.id as StateId);
  }

  function handleMoveDrag(id: string, x: number, y: number) {
    const from = layout.states.find((s) => s.id === id);
    if (from) setConnectLine({ x1: from.rect.x + from.rect.w / 2, y1: from.rect.y + from.rect.h / 2, x2: x, y2: y });
  }

  function handleMoveDrop(id: string, x: number, y: number) {
    setConnectLine(undefined);
    const inRect = (r: { x: number; y: number; w: number; h: number }) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    // innermost composite frame under the pointer wins; none = top level
    const target = layout.states
      .filter((s) => s.composite && s.id !== id && inRect(s.rect))
      .toSorted((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)[0];
    if (!target) {
      moveInto(id as StateId, null);
      return;
    }
    // dropping inside a specific region band keeps the state in that region
    const band = layout.regions.filter((r) => r.parent === target.id && inRect(r.rect))[0];
    moveInto(id as StateId, target.id as StateId, band?.index ?? 0);
  }

  // reducer rejections must be visible, not silent no-ops (L2)
  const [rejectHint, setRejectHint] = useState<string | undefined>(undefined);

  function moveInto(id: StateId, parent: StateId | null, region = 0) {
    const reason = reparentRejection(ir, id, parent, region);
    if (reason !== undefined) {
      setRejectHint(reason);
      setView({ selectedId: id, moveMode: view.moveMode === true });
      return;
    }
    setRejectHint(undefined);
    h.dispatch({ type: "setStateParent", id, parent, region });
    setView({ selectedId: id, moveMode: view.moveMode === true });
  }

  /** Split a new concurrency region off the selection. Mermaid has no syntax
   * for an EMPTY region (it emits nothing between two `--`), so a region only
   * exists once a state lives in it: "+ Region" moves the selected member
   * into a fresh one, or — when the composite itself is selected — its last
   * member, which is the same gesture read from the container's side. */
  function addRegion() {
    if (!selectedState) return;
    const member = selectedState.parent !== undefined
      ? selectedState
      : ir.states.filter((s) => s.parent === selectedState.id).at(-1);
    if (!member?.parent) {
      setRejectHint("select a state inside a composite (or a composite with members)");
      return;
    }
    setRejectHint(undefined);
    h.dispatch({ type: "setStateRegion", id: member.id, region: stateRegionCount(ir, member.parent) });
    setView({ selectedId: member.id, moveMode: view.moveMode === true });
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
    setView({ selectedId: id, moveMode: view.moveMode === true });
  }

  /** Re-point one end of the selected transition. The reducer's rules are the
   * drag-to-connect rules, so its refusal surfaces exactly where a refused
   * drop does — in the toolbar hint, never as a silent no-op. */
  function retargetTransition(ends: { from?: StateId; to?: StateId }) {
    if (!selectedTransition) return;
    const reason = transitionRetargetRejection(ir, selectedTransition.id, ends);
    setRejectHint(reason);
    if (reason === undefined) h.dispatch({ type: "retargetTransition", id: selectedTransition.id, ...ends });
  }

  /** One delete path for the toolbar button, the property window and the
   * Delete/Backspace key — they must agree on what "the selection" is. */
  function removeById(id: string, txn: string) {
    if (ir.states.some((s) => s.id === id)) h.dispatch({ type: "removeState", id: id as StateId }, txn);
    else if (ir.transitions.some((t) => t.id === id)) h.dispatch({ type: "removeTransition", id: id as TransitionId }, txn);
    else if (ir.notes.some((n) => n.id === id)) h.dispatch({ type: "removeStateNote", id: id as NoteId }, txn);
  }

  /** A whole selection leaves as ONE undo step: the shared txn key coalesces
   * the dispatches into a single history entry. */
  function deleteSelected(ids: readonly string[]) {
    if (ids.length === 0) return;
    const txn = `delete:${ids.join(",")}`;
    for (const id of ids) removeById(id, txn);
    setRejectHint(undefined);
    setView({ moveMode: view.moveMode === true });
  }

  function handleBackgroundClick() {
    // in move mode the background means "take it out to the top level"
    if (view.moveInto !== undefined) {
      moveInto(view.moveInto, null);
      return;
    }
    setView({ moveMode: view.moveMode === true });
  }

  const shell = useEditorShell({
    ir,
    layout,
    selectedId: view.selectedId,
    select: (id) => setView((v) => withSelected(v, id)),
    onDelete: deleteSelected,
    onPaste: (next) => h.pushIR(next),
    notify: setRejectHint,
    // "move" in a state diagram already means re-parenting into a
    // composite — the menu re-uses that mode rather than inventing one
    ...(selectedState !== undefined && view.moveInto === undefined
      ? {
          moveItems: [
            {
              label: "移動…（入れ先の状態を選ぶ）",
              run: () => setView({ selectedId: selectedState.id, moveInto: selectedState.id, moveMode: view.moveMode === true }),
            },
          ],
        }
      : {}),
    // Escape drops every pending mode, move mode included
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
        {mode === "standalone" && <button onClick={() => saveMmd(code, "state.mmd")}>Save…</button>}
        <button onClick={addState}>+ State</button>
        <button disabled={childRejection !== undefined} title={childRejection} onClick={addChildState}>
          + Child state
        </button>
        <button title={pseudoRejection("start")} onClick={() => addPseudo("start")}>
          + Start [*]
        </button>
        <button title={pseudoRejection("end")} onClick={() => addPseudo("end")}>
          + End [*]
        </button>
        <button onClick={() => addSpecial("choice")}>+ Choice</button>
        <button onClick={() => addSpecial("fork")}>+ Fork</button>
        <button onClick={() => addSpecial("join")}>+ Join</button>
        <button disabled={selectedState === undefined || noteRejection !== undefined} title={noteRejection} onClick={addNote}>
          + Note
        </button>
        <button
          disabled={selectedState === undefined}
          onClick={() => selectedState && setView({ ...view, transitionFrom: selectedState.id })}
        >
          → Transition from selected
        </button>
        <button
          disabled={selectedState === undefined}
          onClick={() => selectedState && setView({ selectedId: selectedState.id, moveInto: selectedState.id, moveMode: view.moveMode === true })}
        >
          ⊂ Move into…
        </button>
        <button disabled={selectedState === undefined} onClick={addRegion}>
          + Region
        </button>
        <button
          aria-pressed={view.moveMode === true}
          className={view.moveMode === true ? "active" : undefined}
          onClick={() => setView({ ...view, moveMode: view.moveMode !== true })}
        >
          ⇱ Move mode
        </button>
        <button disabled={selection === undefined} onClick={() => deleteSelected(shell.selection.ids)}>
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
          onChange={(e) => h.dispatch({ type: "setDirection", direction: e.target.value as NonNullable<StateIR["direction"]> })}
        >
          <option value="TB">Top→Bottom</option>
          <option value="LR">Left→Right</option>
          <option value="BT">Bottom→Top</option>
          <option value="RL">Right→Left</option>
        </select>
        {view.moveMode === true && (
          <span className="hint">drag a state onto a composite frame to move it in (background = top level)</span>
        )}
        {view.transitionFrom !== undefined && <span className="hint">click a target state…</span>}
        {view.moveInto !== undefined && <span className="hint">click the container state (background = top level)…</span>}
        {rejectHint !== undefined && <span className="hint">{rejectHint}</span>}
      </div>
      <div className="canvas" ref={shell.canvasRef}>
        <ErrorBoundary>
          <StateView
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
            onBackgroundClick={handleBackgroundClick}
            dragMode={view.moveMode === true ? "move" : "connect"}
            onConnectDrag={handleConnectDrag}
            onConnectDrop={handleConnectDrop}
            onMoveDrag={handleMoveDrag}
            onMoveDrop={handleMoveDrop}
            connectLine={connectLine}
            onGestureCancel={() => setConnectLine(undefined)}
          />
        </ErrorBoundary>
        <SelectionOverlay shell={shell} />
        {shell.selection.count <= 1 && selection && (
          <StatePropertyWindow
            selection={selection}
            states={ir.states}
            onRetargetTransition={(end, id) => retargetTransition({ [end]: id as StateId })}
            onSwapTransitionEnds={() =>
              selectedTransition && retargetTransition({ from: selectedTransition.to, to: selectedTransition.from })
            }
            onSelectElement={(id) => {
              setRejectHint(undefined);
              setView({ selectedId: id, moveMode: view.moveMode === true });
            }}
            onChangeStateLabel={(label) =>
              selectedState && h.dispatch({ type: "updateState", id: selectedState.id, label }, `state:${selectedState.id}:label`)
            }
            onChangeStateRegion={(region) => selectedState && h.dispatch({ type: "setStateRegion", id: selectedState.id, region })}
            onChangeStateDirection={(direction) =>
              selectedState && h.dispatch({ type: "setStateDirection", id: selectedState.id, direction })
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
            onDelete={() => deleteSelected(shell.selection.ids)}
            onEditStart={() => {}}
            onEditEnd={h.endEdit}
          />
        )}
      </div>
      <CodeTabs
        onEditStart={() => {}}
        onEditEnd={h.endEdit}
        tabs={[
          {
            id: "mermaid",
            label: "Mermaid",
            code,
            parse: parseStateDiagram,
            // a mermaid edit rebuilds the whole IR from text mermaid cannot
            // spell every action in — re-attach what it could not carry
            onCommit: (next) => h.pushIR(mergeXStateDetail(ir, next), "code-pane"),
            initialDraft: mode === "standalone" ? initial.recoveredText : undefined,
            loadWarnings: load.warnings,
            onValidityChange: setMermaidValid,
          },
          {
            id: "xstate",
            label: "XState",
            hint: XSTATE_SUBSET,
            code: machine.code,
            parse: parseXStateMachine,
            // …and the mirror image: XState has no notes and no direction
            onCommit: (next) => h.pushIR(mergeMermaidDetail(ir, next), "code-pane"),
            codeWarnings: machine.warnings,
            onValidityChange: setMachineValid,
            // the XState tab holds a machine config, not mermaid text
            mermaidText: false,
          },
        ]}
        onMermaidValidityChange={setMermaidJsValid}
      />
    </>
  );
}
