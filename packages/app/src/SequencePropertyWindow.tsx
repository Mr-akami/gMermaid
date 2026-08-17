import type { Branch, Fragment, FragmentKind, Lifeline, Message, MessageArrowType, Note, NotePosition } from "@gmermaid/ir";

export type SequenceSelection =
  | { kind: "lifeline"; lifeline: Lifeline }
  | { kind: "message"; message: Message }
  | { kind: "fragment"; fragment: Fragment }
  | { kind: "branch"; fragment: Fragment; branch: Branch }
  | { kind: "note"; note: Note };

/** loop conditions are canonically "(min,max) exitCondition" — decompose for the form. */
export function parseLoopSpec(condition: string): { min: string; max: string; exit: string } {
  const m = condition.match(/^\((\d*)\s*,\s*(\d*)\)\s*(.*)$/);
  return m ? { min: m[1]!, max: m[2]!, exit: m[3]! } : { min: "", max: "", exit: condition };
}

export function composeLoopSpec(min: string, max: string, exit: string): string {
  return min !== "" || max !== "" ? `(${min},${max}) ${exit}`.trim() : exit;
}

export interface SequencePropertyWindowProps {
  readonly selection: SequenceSelection;
  readonly onChangeLifelineName: (name: string) => void;
  readonly onToggleActor: (isActor: boolean) => void;
  readonly onChangeMessageLabel: (label: string) => void;
  readonly onChangeMessageArrow: (arrow: MessageArrowType) => void;
  readonly onChangeFragmentKind: (kind: FragmentKind) => void;
  /** Edits the FIRST branch's condition (the one shown beside the tab). */
  readonly onChangeFragmentCondition: (condition: string) => void;
  readonly onChangeBranchCondition: (condition: string) => void;
  readonly onChangeNoteText: (text: string) => void;
  readonly onChangeNotePosition: (position: NotePosition) => void;
  readonly onAddBranch: () => void;
  readonly onDelete: () => void;
  /** e.g. a lifeline still referenced by messages cannot be deleted. */
  readonly deleteDisabledReason?: string | undefined;
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
}

function LoopSpecFields({
  condition,
  onChange,
  onEditStart,
  onEditEnd,
}: {
  condition: string;
  onChange: (condition: string) => void;
  onEditStart: () => void;
  onEditEnd: () => void;
}) {
  const spec = parseLoopSpec(condition);
  const common = { onFocus: onEditStart, onBlur: onEditEnd } as const;
  return (
    <>
      <label>
        Min iterations
        <input {...common} value={spec.min} onChange={(e) => onChange(composeLoopSpec(e.target.value, spec.max, spec.exit))} />
      </label>
      <label>
        Max iterations
        <input {...common} value={spec.max} onChange={(e) => onChange(composeLoopSpec(spec.min, e.target.value, spec.exit))} />
      </label>
      <label>
        Exit condition
        <input {...common} value={spec.exit} onChange={(e) => onChange(composeLoopSpec(spec.min, spec.max, e.target.value))} />
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
            <input
              type="checkbox"
              checked={selection.lifeline.isActor}
              onChange={(e) => props.onToggleActor(e.target.checked)}
            />{" "}
            Actor
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
            </select>
          </label>
        </>
      )}
      {selection.kind === "fragment" && (
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
            </select>
          </label>
          {selection.fragment.fragmentKind === "loop" ? (
            <LoopSpecFields
              condition={selection.fragment.branches[0]?.condition ?? ""}
              onChange={props.onChangeFragmentCondition}
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
          {(selection.fragment.fragmentKind === "alt" || selection.fragment.fragmentKind === "par") && (
            <button onClick={props.onAddBranch}>+ Branch</button>
          )}
        </>
      )}
      {selection.kind === "note" && (
        <>
          <h3>Note</h3>
          <label>
            Text
            <input value={selection.note.text} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onChangeNoteText(e.target.value)} />
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
    </div>
  );
}
