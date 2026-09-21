import { useState } from "react";
import { CodePane, type CodePaneProps } from "./CodePane";

export interface CodeTab<T> extends Omit<CodePaneProps<T>, "onEditStart" | "onEditEnd"> {
  readonly id: string;
  readonly label: string;
  /** One line under the tab strip saying what this text is and what it can
   * hold — the subset promise belongs next to the editor, not in a doc. */
  readonly hint?: string;
}

export interface CodeTabsProps<T> {
  readonly tabs: readonly CodeTab<T>[];
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
}

/**
 * Two texts for one IR, side by side in one pane.
 *
 * Every tab stays MOUNTED and is hidden with CSS. A CodePane holds the user's
 * draft in React state, so unmounting the tab they just left would throw away
 * a half-finished edit; and a draft left behind already knows how to
 * self-invalidate when the IR moves under it (`Draft.base`), which is exactly
 * what happens while the other tab is being typed in.
 */
export function CodeTabs<T>({ tabs, onEditStart, onEditEnd }: CodeTabsProps<T>) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  return (
    <div className="code-tabs">
      <div className="code-tab-strip" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === active}
            className={t.id === active ? "code-tab active" : "code-tab"}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map(({ id, label: _label, hint, ...pane }) => (
        <div key={id} className={id === active ? "code-tab-panel" : "code-tab-panel hidden"}>
          {hint !== undefined && <div className="code-tab-hint">{hint}</div>}
          <CodePane {...pane} onEditStart={onEditStart} onEditEnd={onEditEnd} />
        </div>
      ))}
    </div>
  );
}
