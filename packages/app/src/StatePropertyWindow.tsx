import type { StateDirection, StateNode, StateNote, StateNotePosition, StateTransition } from "@gmermaid/ir";

export type StateSelection =
  | {
      kind: "state";
      state: StateNode;
      /** Concurrency regions the PARENT composite currently has (0 = the
       * state lives at the top level, where regions do not exist). */
      parentRegions: number;
      /** True when other states live inside this one — only then does a
       * per-block `direction` mean anything. */
      composite: boolean;
    }
  | { kind: "transition"; transition: StateTransition }
  | { kind: "note"; note: StateNote };

export interface StatePropertyWindowProps {
  readonly selection: StateSelection;
  readonly onChangeStateLabel: (label: string) => void;
  /** `parentRegions` = a fresh region at the end. */
  readonly onChangeStateRegion: (region: number) => void;
  readonly onChangeStateDirection: (direction: StateDirection | null) => void;
  readonly onChangeTransitionLabel: (label: string) => void;
  readonly onChangeNoteText: (text: string) => void;
  readonly onChangeNotePosition: (position: StateNotePosition) => void;
  readonly onDelete: () => void;
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
}

const DIRECTIONS: readonly StateDirection[] = ["TB", "LR", "BT", "RL"];

export function StatePropertyWindow(props: StatePropertyWindowProps) {
  const { selection, onEditStart, onEditEnd } = props;
  return (
    <div className="property-window">
      {selection.kind === "state" ? (
        <>
          <h3>State</h3>
          {selection.state.role === "normal" ? (
            <label>
              Label
              <input
                value={selection.state.label}
                onFocus={onEditStart}
                onBlur={onEditEnd}
                onChange={(e) => props.onChangeStateLabel(e.target.value)}
              />
            </label>
          ) : (
            <div className="hint">{selection.state.role === "start" ? "start [*]" : "end [*]"}</div>
          )}
          {selection.parentRegions > 0 && (
            <label>
              Region
              <select
                aria-label="Region"
                value={selection.state.region ?? 0}
                onChange={(e) => props.onChangeStateRegion(Number(e.target.value))}
              >
                {Array.from({ length: selection.parentRegions }, (_, i) => (
                  <option key={i} value={i}>
                    Region {i + 1}
                  </option>
                ))}
                <option value={selection.parentRegions}>New region</option>
              </select>
            </label>
          )}
          {selection.composite && (
            <label>
              Block direction
              <select
                aria-label="Block direction"
                value={selection.state.direction ?? ""}
                onChange={(e) => props.onChangeStateDirection(e.target.value === "" ? null : (e.target.value as StateDirection))}
              >
                <option value="">Inherit</option>
                {DIRECTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      ) : selection.kind === "transition" ? (
        <>
          <h3>Transition</h3>
          <label>
            Label
            <input
              value={selection.transition.label ?? ""}
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeTransitionLabel(e.target.value)}
            />
          </label>
        </>
      ) : (
        <>
          <h3>Note</h3>
          <label>
            Text
            {/* a textarea, because a note may span lines (`note … end note`) */}
            <textarea
              aria-label="Note text"
              rows={3}
              value={selection.note.text}
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeNoteText(e.target.value)}
            />
          </label>
          <label>
            Position
            <select value={selection.note.position} onChange={(e) => props.onChangeNotePosition(e.target.value as StateNotePosition)}>
              <option value="rightOf">Right of</option>
              <option value="leftOf">Left of</option>
            </select>
          </label>
        </>
      )}
      <button className="danger" onClick={props.onDelete}>
        Delete {selection.kind}
      </button>
    </div>
  );
}
