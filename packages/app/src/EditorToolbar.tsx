import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import type { EditorShell } from "./useEditorShell";

// Every editor's chrome, in three layers so the ten editors cannot drift
// apart again:
//
//   1. document actions (Open / Save / Undo / Redo) belong to the app bar —
//      they are about the diagram as a whole, not the canvas;
//   2. the tool strip over the canvas holds what ADDS things and how the
//      canvas is VIEWED, always in the same place;
//   3. what acts ON the selection floats over the canvas only while there is
//      a selection, instead of a row of disabled buttons that never explain
//      why they are grey.

export interface AppBarSlots {
  readonly file: HTMLElement | null;
  readonly history: HTMLElement | null;
  /** Only the visible editor may fill the slots; hidden ones stay mounted. */
  readonly active: boolean;
}

/** Null when there is no app bar (the review surface): the document actions
 * then stay at the head of the editor's own strip. */
export const AppBarContext = createContext<AppBarSlots | null>(null);

export interface EditorToolbarProps {
  readonly shell: EditorShell;
  readonly history: { readonly undo: () => void; readonly redo: () => void; readonly canUndo: boolean; readonly canRedo: boolean };
  /** Standalone only: the review surface has its own submit instead. */
  readonly file?: { readonly open: () => void; readonly save: () => void } | undefined;
  /** Buttons that add elements. */
  readonly tools: ReactNode;
  /** Diagram-wide settings: direction, title, autonumber… */
  readonly settings?: ReactNode;
  /** Mode toggles that change what a drag on the canvas does (besides the
   * shared rubber band). */
  readonly modes?: ReactNode;
  /** Actions on the current selection; shown only while something is selected. */
  readonly selectionActions?: ReactNode;
  /** A pending gesture's prompt ("click a target node…"). Esc cancels it. */
  readonly prompt?: string | undefined;
  /** Why the last action was refused. */
  readonly notice?: string | undefined;
  /** A standing how-to that has no button of its own. */
  readonly tip?: string | undefined;
}

export function EditorToolbar({ shell, history, file, tools, settings, modes, selectionActions, prompt, notice, tip }: EditorToolbarProps) {
  const slots = useContext(AppBarContext);
  const fileButtons = file && (
    <>
      <button className="btn" onClick={file.open} aria-label="Open…" title="Open a .mmd file">
        <Icon name="open" />
        <span className="btn-label">Open…</span>
      </button>
      <button className="btn" onClick={file.save} aria-label="Save…" title="Download as .mmd">
        <Icon name="save" />
        <span className="btn-label">Save…</span>
      </button>
    </>
  );
  const historyButtons = (
    <>
      <button className="btn icon-only" aria-label="Undo" title="Undo (Ctrl+Z)" onClick={history.undo} disabled={!history.canUndo}>
        <Icon name="undo" />
      </button>
      <button className="btn icon-only" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" onClick={history.redo} disabled={!history.canRedo}>
        <Icon name="redo" />
      </button>
    </>
  );

  const showSelection = shell.selection.count > 0 && selectionActions !== undefined;
  return (
    <>
      {slots?.active === true && slots.file !== null && fileButtons && createPortal(fileButtons, slots.file)}
      {slots?.active === true && slots.history !== null && createPortal(historyButtons, slots.history)}
      <div className="toolbar" role="toolbar" aria-label="Diagram tools">
        {slots === null && (
          <div className="tool-group">
            {fileButtons}
            {historyButtons}
          </div>
        )}
        <div className="tool-group tools-add">{tools}</div>
        {settings !== undefined && <div className="tool-group tools-settings">{settings}</div>}
        <div className="tool-group tools-view">
          {modes}
          <button
            className="btn"
            aria-pressed={shell.marqueeMode}
            title="ドラッグで範囲選択（Shift+ドラッグでも同じ）"
            onClick={shell.toggleMarqueeMode}
          >
            <Icon name="marquee" />
            Select
          </button>
          <button className="btn icon-only" aria-label="Fit view" title="Fit the whole diagram in the canvas" onClick={shell.fitView}>
            <Icon name="fit" />
          </button>
        </div>
      </div>
      <div className="canvas-float">
        {tip !== undefined && prompt === undefined && notice === undefined && <div className="float-tip">{tip}</div>}
        {prompt !== undefined && (
          <div className="float-prompt" role="status">
            {prompt}
            <kbd>Esc</kbd>
          </div>
        )}
        {notice !== undefined && (
          <div className="float-notice" role="status">
            {notice}
          </div>
        )}
        {showSelection && (
          <div className="selection-bar" role="toolbar" aria-label="Selection actions">
            <span className="selection-count">{shell.selection.count} selected</span>
            {selectionActions}
          </div>
        )}
      </div>
    </>
  );
}

/** The selection bar's delete: one look and one name across every kind. */
export function DeleteButton({ onClick, label = "Delete" }: { readonly onClick: () => void; readonly label?: string }) {
  return (
    <button className="btn danger" onClick={onClick}>
      <Icon name="trash" />
      {label}
    </button>
  );
}

/** The direction select four editors share. */
export function DirectionSelect<D extends "TB" | "LR" | "BT" | "RL">({
  value,
  onChange,
}: {
  readonly value: D;
  readonly onChange: (d: D) => void;
}) {
  return (
    <label className="toolbar-field">
      <span>Direction</span>
      <select aria-label="Direction" value={value} onChange={(e) => onChange(e.target.value as D)}>
        <option value="TB">Top → Bottom</option>
        <option value="LR">Left → Right</option>
        <option value="BT">Bottom → Top</option>
        <option value="RL">Right → Left</option>
      </select>
    </label>
  );
}
