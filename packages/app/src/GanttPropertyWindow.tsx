import {
  GANTT_TAGS,
  type GanttSection,
  type GanttTag,
  type GanttTask,
  type GanttTaskEnd,
  type GanttTaskStart,
} from "@gmermaid/ir";

export type GanttSelection =
  | { kind: "task"; task: GanttTask; section: GanttSection; canMoveUp: boolean; canMoveDown: boolean }
  | { kind: "section"; section: GanttSection; canMoveUp: boolean; canMoveDown: boolean };

export interface GanttPropertyWindowProps {
  readonly selection: GanttSelection;
  readonly onChangeTaskName: (name: string) => void;
  /** Why the last name edit was refused (empty, keyword prefix), or undefined. */
  readonly rejectHint?: string | undefined;
  readonly onChangeTaskId: (taskId: string) => void;
  readonly onToggleTag: (tag: GanttTag, on: boolean) => void;
  readonly onChangeStart: (start: GanttTaskStart) => void;
  readonly onChangeEnd: (end: GanttTaskEnd) => void;
  readonly onChangeSectionName: (name: string) => void;
  readonly onMove: (delta: -1 | 1) => void;
  readonly onDelete: () => void;
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
}

const startValue = (start: GanttTaskStart): string =>
  start.kind === "date" ? start.value : start.kind === "after" ? start.ids.join(" ") : "";

const endValue = (end: GanttTaskEnd): string => (end.kind === "until" ? end.ids.join(" ") : end.value);

/** `after a b` / `until a b` take a whitespace-separated reference list. */
const refs = (text: string): string[] => text.split(/\s+/).filter((id) => id !== "");

export function GanttPropertyWindow(props: GanttPropertyWindowProps) {
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

          <div className="tag-row">
            {GANTT_TAGS.map((tag) => (
              <label key={tag} className="tag-check">
                <input
                  type="checkbox"
                  aria-label={`Tag ${tag}`}
                  checked={selection.task.tags.includes(tag)}
                  onChange={(e) => props.onToggleTag(tag, e.target.checked)}
                />
                {tag}
              </label>
            ))}
          </div>

          <label>
            Starts
            <select
              aria-label="Task start mode"
              value={selection.task.start.kind}
              onChange={(e) => {
                const kind = e.target.value as GanttTaskStart["kind"];
                props.onChangeStart(
                  kind === "prev" ? { kind } : kind === "date" ? { kind, value: "" } : { kind: "after", ids: [] },
                );
              }}
            >
              <option value="prev">after the previous task</option>
              <option value="date">on a date</option>
              <option value="after">after task(s)</option>
            </select>
          </label>
          {selection.task.start.kind !== "prev" && (
            <label>
              {selection.task.start.kind === "date" ? "Start date" : "After task ids"}
              <input
                aria-label="Task start value"
                value={startValue(selection.task.start)}
                onFocus={onEditStart}
                onBlur={onEditEnd}
                onChange={(e) =>
                  props.onChangeStart(
                    selection.task.start.kind === "date"
                      ? { kind: "date", value: e.target.value }
                      : { kind: "after", ids: refs(e.target.value) },
                  )
                }
              />
            </label>
          )}

          <label>
            Ends
            <select
              aria-label="Task end mode"
              value={selection.task.end.kind}
              onChange={(e) => {
                const kind = e.target.value as GanttTaskEnd["kind"];
                props.onChangeEnd(
                  kind === "until" ? { kind, ids: [] } : kind === "date" ? { kind, value: "" } : { kind: "duration", value: "1d" },
                );
              }}
            >
              <option value="duration">after a duration</option>
              <option value="date">on a date</option>
              <option value="until">until task(s) start</option>
            </select>
          </label>
          <label>
            {selection.task.end.kind === "duration" ? "Duration" : selection.task.end.kind === "date" ? "End date" : "Until task ids"}
            <input
              aria-label="Task end value"
              value={endValue(selection.task.end)}
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) =>
                props.onChangeEnd(
                  selection.task.end.kind === "until"
                    ? { kind: "until", ids: refs(e.target.value) }
                    : { kind: selection.task.end.kind, value: e.target.value },
                )
              }
            />
          </label>

          <label>
            Id (referenced by after / until)
            <input
              aria-label="Task id"
              value={selection.task.taskId ?? ""}
              disabled={selection.task.start.kind === "prev"}
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeTaskId(e.target.value)}
            />
          </label>
          {selection.task.start.kind === "prev" && (
            // mermaid only reads an id in the 3-field form, which needs a start
            <div className="hint">give the task a start to name it</div>
          )}
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
