import { useEffect, useMemo, useRef, useState } from "react";
import {
  applySequenceAction,
  emptySequence,
  findEventPosition,
  findSequenceBranch,
  findSequenceEvent,
  getContainerEvents,
  messagesTouching,
  newId,
  type EventContainer,
  type LifelineId,
  type SequenceIR,
} from "@gmermaid/ir";
import { layoutSequence, type DropSlot, type SequenceLayout } from "@gmermaid/layout";
import { sequenceToMermaid } from "@gmermaid/mermaid-codegen";
import { parseSequence } from "@gmermaid/mermaid-parser";
import { SequenceView } from "@gmermaid/renderer";
import { measurer } from "./measurer";
import { formatParseErrors, loadInitial, openMmd, saveMmd, useAutosave } from "./persistence";
import { CodePane } from "./CodePane";
import { ErrorBoundary } from "./ErrorBoundary";
import { SequencePropertyWindow, type SequenceSelection } from "./SequencePropertyWindow";
import { useDiagramHistory } from "./useDiagramHistory";

// A composite sample showing alt / opt / loop nesting and a note.
function initialIR(): SequenceIR {
  const sample = `sequenceDiagram
  actor user as User
  participant app as App
  participant api as API
  user->>app: login
  app->>api: authenticate
  alt success
    api-->>app: token
    opt remember me
      app->>app: store token
    end
  else failure
    api-->>app: error
    loop (0,3) until accepted
      app->>user: retry prompt
    end
  end
  Note over app,api: tokens expire after 24h
`;
  const parsed = parseSequence(sample);
  return parsed.ok ? parsed.ir : emptySequence();
}

// ViewState: transient UI state, never part of the IR (ADR 0001).
interface ViewState {
  readonly selectedId?: string;
  readonly messageFrom?: LifelineId;
}

function sameContainer(a: EventContainer, b: DropSlot["container"]): boolean {
  return a.kind === "root" ? b.kind === "root" : b.kind === "branch" && b.branchId === a.branchId;
}

/** y of each event's first row, for resolving fragment-resize drops. */
function rowYMap(layout: SequenceLayout): Map<string, number> {
  const m = new Map<string, number>();
  for (const msg of layout.messages) m.set(msg.id, msg.y);
  for (const f of layout.fragments) m.set(f.id, f.rect.y);
  return m;
}

const STORAGE_KEY = "gmermaid:sequence";

export interface EditorProps {
  readonly loadRequest?: { readonly seq: number; readonly code: string | null } | undefined;
}

export function SequenceEditor({ loadRequest }: EditorProps) {
  const h = useDiagramHistory(() => loadInitial(STORAGE_KEY, parseSequence, initialIR), applySequenceAction);
  const [view, setView] = useState<ViewState>({});
  // drag feedback is view-transient (ADR 0001): the IR changes once, on drop
  const [dropY, setDropY] = useState<number | undefined>(undefined);
  const [dropX, setDropX] = useState<number | undefined>(undefined);
  const [connectLine, setConnectLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | undefined>(undefined);
  const gestureSeq = useRef(0);
  const ir = h.ir;

  const layout = useMemo(() => layoutSequence(ir, measurer), [ir]);
  const code = useMemo(() => sequenceToMermaid(ir), [ir]);
  useAutosave(STORAGE_KEY, code);

  useEffect(() => {
    if (!loadRequest) return;
    if (loadRequest.code === null) {
      h.pushIR(initialIR());
    } else {
      const result = parseSequence(loadRequest.code);
      if (result.ok) h.pushIR(result.ir);
      else alert(`Cannot load stored diagram:\n${formatParseErrors(result.errors)}`);
    }
    setView({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRequest?.seq]);

  async function openFile() {
    const text = await openMmd();
    if (text === null) return;
    const result = parseSequence(text);
    if (result.ok) {
      h.pushIR(result.ir);
      setView({});
    } else {
      alert(`Cannot open file:\n${result.errors.map((e) => `line ${e.line}: ${e.message}`).join("\n")}`);
    }
  }

  const selection: SequenceSelection | undefined = useMemo(() => {
    const id = view.selectedId;
    if (id === undefined) return undefined;
    const lifeline = ir.lifelines.find((l) => l.id === id);
    if (lifeline) return { kind: "lifeline", lifeline };
    const event = findSequenceEvent(ir, id);
    if (event?.kind === "message") return { kind: "message", message: event };
    if (event?.kind === "fragment") return { kind: "fragment", fragment: event };
    if (event?.kind === "note") return { kind: "note", note: event };
    const branchHit = findSequenceBranch(ir, id);
    if (branchHit) return { kind: "branch", ...branchHit };
    return undefined;
  }, [ir, view.selectedId]);

  function addLifeline() {
    const id = newId("lifeline");
    h.dispatch({ type: "addLifeline", lifeline: { id, name: "Participant", isActor: false } });
    setView({ selectedId: id });
  }

  function handleElementClick(id: string) {
    const targetLifeline = ir.lifelines.find((l) => l.id === id);
    if (view.messageFrom !== undefined && targetLifeline) {
      const msgId = newId("message");
      h.dispatch({
        type: "addMessage",
        message: { kind: "message", id: msgId, from: view.messageFrom, to: targetLifeline.id, label: "message", arrow: "solid" },
      });
      setView({ selectedId: msgId });
      return;
    }
    setView({ selectedId: id });
  }

  function nearestSlot(y: number): DropSlot | undefined {
    let best: DropSlot | undefined;
    for (const s of layout.slots) {
      if (best === undefined || Math.abs(s.y - y) < Math.abs(best.y - y)) best = s;
    }
    return best;
  }

  function handleMessageDrop(id: string, y: number) {
    setDropY(undefined);
    const slot = nearestSlot(y);
    const event = findSequenceEvent(ir, id);
    const pos = findEventPosition(ir, id);
    if (!slot || !event || !pos) return;
    let index = slot.index;
    if (sameContainer(pos.container, slot.container)) {
      if (slot.index > pos.index) index -= 1; // removal shifts later slots
      if (index === pos.index) return;
    }
    const container: EventContainer =
      slot.container.kind === "root" ? { kind: "root" } : { kind: "branch", branchId: slot.container.branchId };
    h.dispatch({ type: "moveEventTo", id: event.id, container, index });
  }

  function handleFragmentBottomDrop(id: string, y: number) {
    setDropY(undefined);
    const frag = findSequenceEvent(ir, id);
    const pos = findEventPosition(ir, id);
    if (frag?.kind !== "fragment" || !pos) return;
    const lastBranch = frag.branches[frag.branches.length - 1];
    if (!lastBranch) return;
    const rowY = rowYMap(layout);
    gestureSeq.current += 1;
    const txnKey = `frag-resize:${id}:${gestureSeq.current}`; // one gesture = one undo step

    const siblings = getContainerEvents(ir, pos.container);
    const pullIn = siblings.slice(pos.index + 1).filter((e) => (rowY.get(e.id) ?? Infinity) < y);
    if (pullIn.length > 0) {
      for (const e of pullIn) {
        h.dispatch(
          { type: "moveEventTo", id: e.id, container: { kind: "branch", branchId: lastBranch.id }, index: Number.MAX_SAFE_INTEGER },
          txnKey,
        );
      }
      h.endEdit();
      return;
    }
    // shrink: push trailing events of the last branch back out, after the fragment
    for (let i = lastBranch.events.length - 1; i >= 0; i--) {
      const e = lastBranch.events[i]!;
      if ((rowY.get(e.id) ?? -Infinity) <= y) break;
      h.dispatch({ type: "moveEventTo", id: e.id, container: pos.container, index: pos.index + 1 }, txnKey);
    }
    h.endEdit();
  }

  function handleDividerDrop(branchId: string, y: number) {
    setDropY(undefined);
    const hit = findSequenceBranch(ir, branchId);
    if (!hit) return;
    const bi = hit.fragment.branches.findIndex((b) => b.id === branchId);
    if (bi <= 0) return;
    const prev = hit.fragment.branches[bi - 1]!;
    const rowY = rowYMap(layout);
    gestureSeq.current += 1;
    const txnKey = `divider:${branchId}:${gestureSeq.current}`;

    // divider dragged down: leading events of this branch move up into prev
    const down = [];
    for (const e of hit.branch.events) {
      if ((rowY.get(e.id) ?? Infinity) < y) down.push(e);
      else break;
    }
    if (down.length > 0) {
      for (const e of down) {
        h.dispatch(
          { type: "moveEventTo", id: e.id, container: { kind: "branch", branchId: prev.id }, index: Number.MAX_SAFE_INTEGER },
          txnKey,
        );
      }
      h.endEdit();
      return;
    }
    // divider dragged up: trailing events of prev move down to this branch's head
    for (let i = prev.events.length - 1; i >= 0; i--) {
      const e = prev.events[i]!;
      if ((rowY.get(e.id) ?? -Infinity) <= y) break;
      h.dispatch({ type: "moveEventTo", id: e.id, container: { kind: "branch", branchId: hit.branch.id }, index: 0 }, txnKey);
    }
    h.endEdit();
  }

  function wrapSelected(kind: "alt" | "opt" | "loop" | "par") {
    if (selection?.kind !== "message") return;
    const defaultCondition = kind === "loop" ? "(1,3) until done" : kind === "par" ? "" : "condition";
    h.dispatch({
      type: "wrapInFragment",
      fragmentId: newId("fragment"),
      branchId: newId("branch"),
      fragmentKind: kind,
      condition: defaultCondition,
      eventIds: [selection.message.id],
    });
  }

  function addNote() {
    const noteId = newId("note");
    if (selection?.kind === "message") {
      // annotate the selected message: place the note right after it
      const pos = findEventPosition(ir, selection.message.id);
      if (!pos) return;
      h.dispatch({
        type: "addEventAt",
        event: { kind: "note", id: noteId, position: "over", lifelines: [selection.message.from, selection.message.to], text: "note" },
        container: pos.container,
        index: pos.index + 1,
      });
    } else if (selection?.kind === "lifeline") {
      h.dispatch({
        type: "addEventAt",
        event: { kind: "note", id: noteId, position: "rightOf", lifelines: [selection.lifeline.id], text: "note" },
        container: { kind: "root" },
        index: Number.MAX_SAFE_INTEGER,
      });
    } else {
      const first = ir.lifelines[0];
      if (!first) return;
      h.dispatch({
        type: "addEventAt",
        event: { kind: "note", id: noteId, position: "over", lifelines: [first.id], text: "note" },
        container: { kind: "root" },
        index: Number.MAX_SAFE_INTEGER,
      });
    }
    setView({ selectedId: noteId });
  }

  function handleLifelineDrop(id: string, x: number) {
    setDropX(undefined);
    const self = ir.lifelines.find((l) => l.id === id);
    if (!self) return;
    const others = layout.lifelines.filter((l) => l.id !== id);
    const index = others.filter((l) => l.x < x).length;
    h.dispatch({ type: "moveLifeline", id: self.id, index });
  }

  function handleSpineDrag(id: string, x: number, y: number) {
    const from = layout.lifelines.find((l) => l.id === id);
    if (from) setConnectLine({ x1: from.x, y1: y, x2: x, y2: y });
  }

  function handleSpineDrop(id: string, x: number, y: number) {
    setConnectLine(undefined);
    const from = ir.lifelines.find((l) => l.id === id);
    if (!from) return;
    let target: (typeof layout.lifelines)[number] | undefined;
    for (const l of layout.lifelines) {
      if (l.id === id) continue;
      if (Math.abs(l.x - x) < 40 && (target === undefined || Math.abs(l.x - x) < Math.abs(target.x - x))) target = l;
    }
    if (!target) return;
    const to = ir.lifelines.find((l) => l.id === target!.id);
    const slot = nearestSlot(y);
    if (!to || !slot) return;
    const msgId = newId("message");
    const container: EventContainer =
      slot.container.kind === "root" ? { kind: "root" } : { kind: "branch", branchId: slot.container.branchId };
    h.dispatch({
      type: "addEventAt",
      event: { kind: "message", id: msgId, from: from.id, to: to.id, label: "message", arrow: "solid" },
      container,
      index: slot.index,
    });
    setView({ selectedId: msgId });
  }

  const selectedLifeline = selection?.kind === "lifeline" ? selection.lifeline : undefined;

  return (
    <>
      <div className="toolbar">
        <button onClick={openFile}>Open…</button>
        <button onClick={() => saveMmd(code, "sequence.mmd")}>Save…</button>
        <button onClick={addLifeline}>+ Lifeline</button>
        <button
          disabled={selectedLifeline === undefined}
          onClick={() => selectedLifeline && setView({ ...view, messageFrom: selectedLifeline.id })}
        >
          → Message from selected
        </button>
        <button disabled={selection?.kind !== "message"} onClick={() => wrapSelected("alt")}>Wrap in alt</button>
        <button disabled={selection?.kind !== "message"} onClick={() => wrapSelected("opt")}>opt</button>
        <button disabled={selection?.kind !== "message"} onClick={() => wrapSelected("loop")}>loop</button>
        <button onClick={addNote}>+ Note</button>
        <button onClick={h.undo} disabled={!h.canUndo}>Undo</button>
        <button onClick={h.redo} disabled={!h.canRedo}>Redo</button>
        {view.messageFrom !== undefined && <span className="hint">click a target lifeline…</span>}
      </div>
      <div className="canvas">
        <ErrorBoundary>
          <SequenceView
            layout={layout}
            viewState={{ selectedId: view.selectedId }}
            onElementClick={handleElementClick}
            onBackgroundClick={() => setView({})}
            onMessageDrag={(_, y) => setDropY(nearestSlot(y)?.y)}
            onMessageDrop={handleMessageDrop}
            onFragmentBottomDrag={(_, y) => setDropY(y)}
            onFragmentBottomDrop={handleFragmentBottomDrop}
            onDividerDrag={(_, y) => setDropY(y)}
            onDividerDrop={handleDividerDrop}
            onLifelineDrag={(_, x) => setDropX(x)}
            onLifelineDrop={handleLifelineDrop}
            onSpineDrag={handleSpineDrag}
            onSpineDrop={handleSpineDrop}
            dropIndicatorY={dropY}
            dropIndicatorX={dropX}
            connectLine={connectLine}
            onGestureCancel={() => {
              setDropY(undefined);
              setDropX(undefined);
              setConnectLine(undefined);
            }}
          />
        </ErrorBoundary>
        {selection && (
          <SequencePropertyWindow
            selection={selection}
            onChangeLifelineName={(name) =>
              selection.kind === "lifeline" &&
              h.dispatch({ type: "updateLifeline", id: selection.lifeline.id, name }, `lifeline:${selection.lifeline.id}:name`)
            }
            onToggleActor={(isActor) =>
              selection.kind === "lifeline" && h.dispatch({ type: "updateLifeline", id: selection.lifeline.id, isActor })
            }
            onChangeMessageLabel={(label) =>
              selection.kind === "message" &&
              h.dispatch({ type: "updateMessage", id: selection.message.id, label }, `message:${selection.message.id}:label`)
            }
            onChangeMessageArrow={(arrow) =>
              selection.kind === "message" && h.dispatch({ type: "updateMessage", id: selection.message.id, arrow })
            }
            onChangeFragmentKind={(fragmentKind) =>
              selection.kind === "fragment" && h.dispatch({ type: "updateFragment", id: selection.fragment.id, fragmentKind })
            }
            onChangeFragmentCondition={(condition) => {
              if (selection.kind !== "fragment") return;
              const first = selection.fragment.branches[0];
              if (first) h.dispatch({ type: "updateBranch", id: first.id, condition }, `branch:${first.id}:cond`);
            }}
            onChangeNoteText={(text) =>
              selection.kind === "note" && h.dispatch({ type: "updateNote", id: selection.note.id, text }, `note:${selection.note.id}:text`)
            }
            onChangeNotePosition={(position) =>
              selection.kind === "note" && h.dispatch({ type: "updateNote", id: selection.note.id, position })
            }
            onChangeBranchCondition={(condition) =>
              selection.kind === "branch" &&
              h.dispatch({ type: "updateBranch", id: selection.branch.id, condition }, `branch:${selection.branch.id}:cond`)
            }
            onAddBranch={() =>
              selection.kind === "fragment" &&
              h.dispatch({ type: "addBranch", fragmentId: selection.fragment.id, branchId: newId("branch"), condition: "" })
            }
            onDelete={() => {
              if (selection.kind === "lifeline") h.dispatch({ type: "removeLifeline", id: selection.lifeline.id });
              if (selection.kind === "message") h.dispatch({ type: "removeEvent", id: selection.message.id });
              if (selection.kind === "fragment") h.dispatch({ type: "removeEvent", id: selection.fragment.id });
              if (selection.kind === "note") h.dispatch({ type: "removeEvent", id: selection.note.id });
              setView({});
            }}
            deleteDisabledReason={
              selection.kind === "lifeline" && messagesTouching(ir.events, selection.lifeline.id)
                ? "Remove its messages first"
                : undefined
            }
            onEditStart={() => {}}
            onEditEnd={h.endEdit}
          />
        )}
      </div>
      <CodePane
        code={code}
        parse={parseSequence}
        onCommit={(next) => h.pushIR(next, "code-pane")}
        onEditStart={() => {}}
        onEditEnd={h.endEdit}
      />
    </>
  );
}
