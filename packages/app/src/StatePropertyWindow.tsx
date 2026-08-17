import type { StateNode, StateTransition } from "@gmermaid/ir";

export type StateSelection =
  | { kind: "state"; state: StateNode }
  | { kind: "transition"; transition: StateTransition };

export interface StatePropertyWindowProps {
  readonly selection: StateSelection;
  readonly onChangeStateLabel: (label: string) => void;
  readonly onChangeTransitionLabel: (label: string) => void;
  readonly onDelete: () => void;
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
}

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
        </>
      ) : (
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
      )}
      <button className="danger" onClick={props.onDelete}>
        Delete {selection.kind}
      </button>
    </div>
  );
}
