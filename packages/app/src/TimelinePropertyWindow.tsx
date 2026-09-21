import type { TimelineEvent, TimelinePeriod, TimelineSection } from "@gmermaid/ir";

export type TimelineSelection =
  | { kind: "section"; section: TimelineSection }
  | { kind: "period"; period: TimelinePeriod }
  | { kind: "event"; event: TimelineEvent };

export interface TimelinePropertyWindowProps {
  readonly selection: TimelineSelection;
  readonly onChangeSectionName: (name: string) => void;
  readonly onChangePeriodLabel: (label: string) => void;
  readonly onChangeEventText: (text: string) => void;
  /** -1 = earlier (left / up), +1 = later (right / down). */
  readonly onMove: (delta: -1 | 1) => void;
  readonly onDelete: () => void;
  /** Why the last edit was refused (`:`, empty), or undefined. */
  readonly rejectHint?: string | undefined;
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
}

export function TimelinePropertyWindow(props: TimelinePropertyWindowProps) {
  const { selection, onEditStart, onEditEnd } = props;
  return (
    <div className="property-window">
      {selection.kind === "section" ? (
        <>
          <h3>Section</h3>
          <label>
            Section name
            <input
              value={selection.section.name}
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeSectionName(e.target.value)}
            />
          </label>
        </>
      ) : selection.kind === "period" ? (
        <>
          <h3>Period</h3>
          <label>
            Period label
            <input
              value={selection.period.label}
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangePeriodLabel(e.target.value)}
            />
          </label>
          <div className="row-buttons">
            <button onClick={() => props.onMove(-1)}>← Move left</button>
            <button onClick={() => props.onMove(1)}>Move right →</button>
          </div>
        </>
      ) : (
        <>
          <h3>Event</h3>
          <label>
            Event text
            <textarea
              rows={3}
              value={selection.event.text}
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeEventText(e.target.value)}
            />
          </label>
          <div className="row-buttons">
            <button onClick={() => props.onMove(-1)}>↑ Move up</button>
            <button onClick={() => props.onMove(1)}>↓ Move down</button>
          </div>
        </>
      )}
      {props.rejectHint !== undefined && <div className="hint">{props.rejectHint}</div>}
      <button className="danger" onClick={props.onDelete}>
        Delete {selection.kind}
      </button>
    </div>
  );
}
