import type {
  Box,
  BoxId,
  Branch,
  Fragment,
  FragmentKind,
  Lifeline,
  Message,
  MessageArrowType,
  Note,
  NotePosition,
  ParticipantKind,
} from "@gmermaid/ir";
import { PARTICIPANT_KINDS } from "@gmermaid/ir";

/** What the Box select emits: an existing box, no box, or "make a new one". */
export type BoxChoice = BoxId | null | "new";

export type SequenceSelection =
  | { kind: "lifeline"; lifeline: Lifeline }
  | { kind: "message"; message: Message }
  | { kind: "fragment"; fragment: Fragment }
  | { kind: "branch"; fragment: Fragment; branch: Branch }
  | { kind: "note"; note: Note };

export interface SequencePropertyWindowProps {
  readonly selection: SequenceSelection;
  readonly onChangeLifelineName: (name: string) => void;
  readonly onChangeLifelineKind: (kind: ParticipantKind) => void;
  /** Boxes offered in the lifeline's Box select. */
  readonly boxes: readonly Box[];
  readonly lifelineBox?: Box | undefined;
  readonly onChangeLifelineBox: (choice: BoxChoice) => void;
  readonly onChangeBoxName: (name: string) => void;
  readonly onChangeBoxColor: (color: string) => void;
  /** create/destroy events for the selected lifeline (first/last message). */
  readonly lifelineCreated: boolean;
  readonly lifelineDestroyed: boolean;
  readonly onToggleCreated: (on: boolean) => void;
  readonly onToggleDestroyed: (on: boolean) => void;
  readonly onChangeMessageActivation: (activate: "start" | "end" | null) => void;
  readonly onChangeMessageLabel: (label: string) => void;
  readonly onChangeMessageArrow: (arrow: MessageArrowType) => void;
  readonly onChangeFragmentKind: (kind: FragmentKind) => void;
  /** Edits the FIRST branch's condition (the one shown beside the tab). */
  readonly onChangeFragmentCondition: (condition: string) => void;
  /** Loop bounds are structural on the branch (B-2), never text-embedded. */
  readonly onChangeLoopBounds: (min: string, max: string) => void;
  readonly onChangeBranchCondition: (condition: string) => void;
  readonly onChangeNoteText: (text: string) => void;
  readonly onChangeNotePosition: (position: NotePosition) => void;
  readonly onAddBranch: () => void;
  readonly onDelete: () => void;
  /** e.g. a lifeline still referenced by messages cannot be deleted. */
  readonly deleteDisabledReason?: string | undefined;
  /** Shown beside an ENABLED delete button, e.g. "also deletes its messages". */
  readonly deleteWarning?: string | undefined;
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
}

function LoopSpecFields({
  branch,
  onChangeCondition,
  onChangeBounds,
  onEditStart,
  onEditEnd,
}: {
  branch: Branch;
  onChangeCondition: (condition: string) => void;
  onChangeBounds: (min: string, max: string) => void;
  onEditStart: () => void;
  onEditEnd: () => void;
}) {
  const min = branch.loopBounds?.min ?? "";
  const max = branch.loopBounds?.max ?? "";
  const common = { onFocus: onEditStart, onBlur: onEditEnd } as const;
  return (
    <>
      <label>
        Min iterations
        <input
          {...common}
          inputMode="numeric"
          value={min}
          onChange={(e) => onChangeBounds(e.target.value.replaceAll(/[^0-9]/g, ""), max)}
        />
      </label>
      <label>
        Max iterations
        <input
          {...common}
          inputMode="numeric"
          value={max}
          onChange={(e) => onChangeBounds(min, e.target.value.replaceAll(/[^0-9]/g, ""))}
        />
      </label>
      <label>
        Exit condition
        <input {...common} value={branch.condition} onChange={(e) => onChangeCondition(e.target.value)} />
      </label>
    </>
  );
}

export function SequencePropertyWindow(props: SequencePropertyWindowProps) {
  const { selection, onEditStart, onEditEnd } = props;

  return (
    <div className="property-window">
      {selection.kind === "lifeline" && (
        <>
          <h3>Lifeline</h3>
          <label>
            Name
            <input
              value={selection.lifeline.name}
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeLifelineName(e.target.value)}
            />
          </label>
          <label>
            Type
            <select
              value={selection.lifeline.kind}
              onChange={(e) => props.onChangeLifelineKind(e.target.value as ParticipantKind)}
            >
              {PARTICIPANT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label>
            Box
            <select
              value={props.lifelineBox?.id ?? ""}
              onChange={(e) => props.onChangeLifelineBox(e.target.value === "" ? null : e.target.value === "new" ? "new" : (e.target.value as BoxId))}
            >
              <option value="">(none)</option>
              {props.boxes.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name === "" ? b.id : b.name}
                </option>
              ))}
              <option value="new">New box…</option>
            </select>
          </label>
          {props.lifelineBox !== undefined && (
            <>
              <label>
                Box name
                <input
                  value={props.lifelineBox.name}
                  onFocus={onEditStart}
                  onBlur={onEditEnd}
                  onChange={(e) => props.onChangeBoxName(e.target.value)}
                />
              </label>
              <label>
                Box color
                <input
                  value={props.lifelineBox.color ?? ""}
                  placeholder="rgb(200,220,255)"
                  onFocus={onEditStart}
                  onBlur={onEditEnd}
                  onChange={(e) => props.onChangeBoxColor(e.target.value)}
                />
              </label>
            </>
          )}
          <label>
            <input type="checkbox" checked={props.lifelineCreated} onChange={(e) => props.onToggleCreated(e.target.checked)} />{" "}
            Created at first message
          </label>
          <label>
            <input type="checkbox" checked={props.lifelineDestroyed} onChange={(e) => props.onToggleDestroyed(e.target.checked)} />{" "}
            Destroyed at last message
          </label>
        </>
      )}
      {selection.kind === "message" && (
        <>
          <h3>Message</h3>
          <label>
            Label
            <input
              value={selection.message.label}
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeMessageLabel(e.target.value)}
            />
          </label>
          <label>
            Arrow
            <select
              value={selection.message.arrow}
              onChange={(e) => props.onChangeMessageArrow(e.target.value as MessageArrowType)}
            >
              <option value="solid">Solid (→ filled)</option>
              <option value="dotted">Dotted (⇢ filled)</option>
              <option value="solidOpen">Solid (open head)</option>
              <option value="dottedOpen">Dotted (open head)</option>
              <option value="async">Async</option>
              <option value="dottedAsync">Async (dotted)</option>
              <option value="cross">Cross (✕)</option>
              <option value="dottedCross">Cross (dotted)</option>
              <option value="bidirectional">Bidirectional</option>
              <option value="dottedBidirectional">Bidirectional (dotted)</option>
            </select>
          </label>
          <label>
            Activation
            <select
              value={selection.message.activate ?? ""}
              onChange={(e) => props.onChangeMessageActivation(e.target.value === "" ? null : (e.target.value as "start" | "end"))}
            >
              <option value="">(none)</option>
              <option value="start">Activate target (+)</option>
              <option value="end">Deactivate source (-)</option>
            </select>
          </label>
        </>
      )}
      {selection.kind === "fragment" && selection.fragment.fragmentKind === "rect" && (
        <>
          <h3>Rect</h3>
          <label>
            Fill color
            <input
              value={selection.fragment.branches[0]?.condition ?? ""}
              placeholder="rgb(0,0,255)"
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeFragmentCondition(e.target.value)}
            />
          </label>
        </>
      )}
      {selection.kind === "fragment" && selection.fragment.fragmentKind !== "rect" && (
        <>
          <h3>Fragment</h3>
          <label>
            Kind
            <select
              value={selection.fragment.fragmentKind}
              onChange={(e) => props.onChangeFragmentKind(e.target.value as FragmentKind)}
            >
              <option value="alt">alt</option>
              <option value="opt">opt</option>
              <option value="loop">loop</option>
              <option value="par">par</option>
              <option value="break">break</option>
              <option value="critical">critical</option>
            </select>
          </label>
          {selection.fragment.fragmentKind === "loop" && selection.fragment.branches[0] !== undefined ? (
            <LoopSpecFields
              branch={selection.fragment.branches[0]}
              onChangeCondition={props.onChangeFragmentCondition}
              onChangeBounds={props.onChangeLoopBounds}
              onEditStart={onEditStart}
              onEditEnd={onEditEnd}
            />
          ) : (
            <label>
              Condition
              <input
                value={selection.fragment.branches[0]?.condition ?? ""}
                onFocus={onEditStart}
                onBlur={onEditEnd}
                onChange={(e) => props.onChangeFragmentCondition(e.target.value)}
              />
            </label>
          )}
          {["alt", "par", "critical"].includes(selection.fragment.fragmentKind) && (
            <button onClick={props.onAddBranch}>+ Branch</button>
          )}
        </>
      )}
      {selection.kind === "note" && (
        <>
          <h3>Note</h3>
          <label>
            Text
            <textarea
              rows={3}
              value={selection.note.text}
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeNoteText(e.target.value)}
            />
          </label>
          <label>
            Position
            <select value={selection.note.position} onChange={(e) => props.onChangeNotePosition(e.target.value as NotePosition)}>
              <option value="over">Over</option>
              <option value="leftOf">Left of</option>
              <option value="rightOf">Right of</option>
            </select>
          </label>
        </>
      )}
      {selection.kind === "branch" && (
        <>
          <h3>Branch ({selection.fragment.fragmentKind})</h3>
          <label>
            Condition
            <input
              value={selection.branch.condition}
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeBranchCondition(e.target.value)}
            />
          </label>
        </>
      )}
      {selection.kind !== "branch" && (
        <button
          className="danger"
          onClick={props.onDelete}
          disabled={props.deleteDisabledReason !== undefined}
          title={props.deleteDisabledReason}
        >
          Delete {selection.kind}
        </button>
      )}
      {props.deleteDisabledReason !== undefined && <div className="hint">{props.deleteDisabledReason}</div>}
      {props.deleteDisabledReason === undefined && props.deleteWarning !== undefined && (
        <div className="hint">{props.deleteWarning}</div>
      )}
    </div>
  );
}
