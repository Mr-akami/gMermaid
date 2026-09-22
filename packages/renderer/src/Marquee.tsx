import type { Rect } from "@gmermaid/layout";

/** What every view's ViewState owes the selection. `selectedId` stays the
 * ONE element the property window is about; `selectedIds` is the whole
 * selection, which is usually the same single id. */
export interface SelectionViewState {
  readonly selectedId?: string | undefined;
  readonly selectedIds?: readonly string[] | undefined;
}

/** Selection lookup for a view's render pass — built once, asked per element. */
export function selectionOf(viewState: SelectionViewState): ReadonlySet<string> {
  const ids = new Set<string>(viewState.selectedIds ?? []);
  if (viewState.selectedId !== undefined) ids.add(viewState.selectedId);
  return ids;
}

/** The rubber band, drawn inside the view's root group (diagram coordinates)
 * so it stays glued to the diagram while the pointer moves. */
export function MarqueeRect({ band }: { band: Rect }) {
  return (
    <rect
      data-gm-marquee=""
      x={band.x}
      y={band.y}
      width={band.w}
      height={band.h}
      fill="var(--gm-selected, #1a73e8)"
      fillOpacity={0.08}
      stroke="var(--gm-selected, #1a73e8)"
      strokeWidth={1}
      strokeDasharray="4 3"
      style={{ pointerEvents: "none" }}
    />
  );
}
