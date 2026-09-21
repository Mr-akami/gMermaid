import { JOURNEY_MAX_SCORE, JOURNEY_MIN_SCORE, type JourneySection, type JourneyTask } from "@gmermaid/ir";

export type JourneySelection =
  | { kind: "task"; task: JourneyTask; section: JourneySection; canMoveUp: boolean; canMoveDown: boolean }
  | { kind: "section"; section: JourneySection; canMoveUp: boolean; canMoveDown: boolean };

export interface JourneyPropertyWindowProps {
  readonly selection: JourneySelection;
  readonly onChangeTaskName: (name: string) => void;
  /** Why the last name edit was refused (empty, `title` prefix), or undefined. */
  readonly rejectHint?: string | undefined;
  readonly onChangeTaskScore: (score: number) => void;
  readonly onChangeTaskActors: (actors: readonly string[]) => void;
  readonly onChangeSectionName: (name: string) => void;
  readonly onMove: (delta: -1 | 1) => void;
  readonly onDelete: () => void;
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
}

const SCORES = Array.from({ length: JOURNEY_MAX_SCORE - JOURNEY_MIN_SCORE + 1 }, (_, i) => JOURNEY_MIN_SCORE + i);

export function JourneyPropertyWindow(props: JourneyPropertyWindowProps) {
  const { selection, onEditStart, onEditEnd } = props;
  return (
    <div className="property-window">
      {selection.kind === "task" ? (
        <>
          <h3>Task</h3>
          <label>
            Name
            <input
              aria-label="Task name"
              value={selection.task.name}
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeTaskName(e.target.value)}
            />
          </label>
          <label>
            Score (1–5)
            <select
              aria-label="Task score"
              value={String(selection.task.score)}
              onChange={(e) => props.onChangeTaskScore(Number(e.target.value))}
            >
              {/* an imported diagram may carry a score outside 1..5; keep it
                  selectable so editing another field cannot silently clamp it */}
              {!SCORES.some((s) => s === selection.task.score) && (
                <option value={String(selection.task.score)}>{selection.task.score} (out of range)</option>
              )}
              {SCORES.map((s) => (
                <option key={s} value={String(s)}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Actors (comma separated)
            <input
              aria-label="Task actors"
              value={selection.task.actors.join(", ")}
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeTaskActors(e.target.value.split(","))}
            />
          </label>
          <div className="hint">in section: {selection.section.name === "" ? "(unnamed)" : selection.section.name}</div>
        </>
      ) : (
        <>
          <h3>Section</h3>
          <label>
            Name
            <input
              aria-label="Section name"
              value={selection.section.name}
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeSectionName(e.target.value)}
            />
          </label>
          <div className="hint">{selection.section.tasks.length} task(s)</div>
        </>
      )}
      <div className="row-buttons">
        <button aria-label="Move earlier" disabled={!selection.canMoveUp} onClick={() => props.onMove(-1)}>
          ↑ Earlier
        </button>
        <button aria-label="Move later" disabled={!selection.canMoveDown} onClick={() => props.onMove(1)}>
          ↓ Later
        </button>
      </div>
      {props.rejectHint !== undefined && <div className="hint">{props.rejectHint}</div>}
      <button className="danger" onClick={props.onDelete}>
        Delete {selection.kind}
      </button>
    </div>
  );
}
