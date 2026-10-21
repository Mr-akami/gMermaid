import { ContextMenu } from "./ContextMenu";
import type { EditorShell } from "./useEditorShell";

// The selection UI every editor shows over its canvas, in one place so the
// ten editors cannot drift apart: the window that stands in for the property
// window when several things are selected, and the context menu. The
// rubber-band toggle lives in EditorToolbar.
//
// Dragging empty canvas pans, and panning is the commoner action by far, so
// the band could not simply take the drag. A bare modifier (Shift+drag)
// would have been invisible, so the toolbar carries a toggle and Shift+drag
// works as the accelerator for anyone who finds it.

/** The window for a selection of several elements: no properties to edit,
 * but the count and the actions that do make sense for a group. */
export function MultiSelectionWindow({ shell }: { readonly shell: EditorShell }) {
  return (
    <div className="property-window">
      <h3>{shell.selection.count} 個の要素を選択中</h3>
      <p className="hint">個別のプロパティは 1 つだけ選ぶと編集できます。</p>
      <div className="row-buttons">
        <button onClick={shell.copy}>コピー</button>
        <button className="danger" onClick={shell.deleteSelection}>
          削除
        </button>
      </div>
    </div>
  );
}

/** Everything the shell draws over the canvas. One line per editor. */
export function SelectionOverlay({ shell }: { readonly shell: EditorShell }) {
  return (
    <>
      {shell.selection.count > 1 && <MultiSelectionWindow shell={shell} />}
      {shell.menu !== undefined && <ContextMenu menu={shell.menu} onClose={shell.closeMenu} />}
    </>
  );
}
