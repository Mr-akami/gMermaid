import { useCallback, useEffect, useRef, useState, type PointerEvent, type MouseEvent } from "react";
import type { Rect } from "@gmermaid/layout";

/** Pan/zoom state (ViewState, ADR 0001): applied as a transform on the SVG
 * root group — changing it never triggers a relayout. */
export interface Viewport {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;

/** Every view wraps its content in ONE group carrying this attribute and the
 * viewport transform. Measuring that group (getBBox, in diagram coordinates)
 * is how the editor frames a diagram: the layout's `size` misses whatever a
 * view draws outside it, such as a boundary title above its frame. */
export const DIAGRAM_ROOT_ATTR = "data-gm-root";

/** How long a press has to stand still before it means "open the menu".
 * Same order as a mobile long press; short enough that nobody waits, long
 * enough that a slow drag is not ambushed by a menu. */
export const LONG_PRESS_MS = 500;

/** Where a context menu was asked for, in CLIENT coordinates — the menu is
 * an HTML overlay, not part of the diagram, so it is placed on screen. */
export interface MenuRequest {
  /** The element under the pointer, or null on empty canvas. */
  readonly id: string | null;
  readonly clientX: number;
  readonly clientY: number;
}

/**
 * The selection gestures every view shares: the rubber band, and the two
 * ways a user asks for a context menu. Views take this as ONE prop and hand
 * it straight to the hook — ten views do not each need to grow four props.
 */
export interface SelectionGestures {
  /** While true, dragging empty canvas draws a band instead of panning.
   * Shift+drag does the same without the mode, so the toolbar toggle is the
   * discoverable path and the modifier is the accelerator. */
  readonly marqueeMode?: boolean | undefined;
  /** The band the user just finished drawing, in diagram coordinates.
   * `additive` = the drag started with Ctrl/Cmd held. */
  readonly onMarquee?: ((band: Rect, additive: boolean) => void) | undefined;
  /** Right click, or a press held still for LONG_PRESS_MS. */
  readonly onMenu?: ((req: MenuRequest) => void) | undefined;
}

// Shared pointer rules for all three diagram views: 5px Chebyshev threshold,
// click resolved on pointerup from the ORIGINAL press target (pointer capture
// retargets native clicks to the svg root), always capture so pointerup
// reaches us outside the svg, left/primary pointer only. A change here
// changes every view — that is the point (they used to drift in triplicate).
export interface PointerGestureOptions {
  /** Diagram padding folded into the default viewport translation. */
  readonly padding: number;
  readonly viewport?: Viewport | undefined;
  /** Enables background-drag panning and wheel zoom when provided. */
  readonly onViewportChange?: ((v: Viewport) => void) | undefined;
  /** data-drag values this view understands; other values are ignored. */
  readonly dragKinds: readonly string[];
  /** `additive` = Ctrl/Cmd/Shift was held, i.e. "add to the selection". */
  readonly onElementClick?: ((id: string, additive: boolean) => void) | undefined;
  readonly onBackgroundClick?: (() => void) | undefined;
  /** Live drag past the threshold, in diagram coordinates. */
  readonly onDrag?: ((kind: string, id: string, x: number, y: number) => void) | undefined;
  readonly onDrop?: ((kind: string, id: string, x: number, y: number) => void) | undefined;
  readonly onGestureCancel?: (() => void) | undefined;
  readonly selection?: SelectionGestures | undefined;
}

interface PointerState {
  targetId: string | null;
  dragKind: string | null;
  /** screen-space press point: the click threshold must not shrink when zoomed out */
  screenX: number;
  screenY: number;
  /** press point in diagram coordinates — the band's fixed corner */
  diagramX: number;
  diagramY: number;
  /** viewport at press time, for panning */
  viewport: Viewport;
  active: boolean;
  /** this drag draws a band rather than panning */
  banding: boolean;
  additive: boolean;
}

const DRAG_THRESHOLD = 5;

export interface PointerGestureProps {
  readonly viewport: Viewport;
  readonly onPointerDown: (e: PointerEvent<SVGSVGElement>) => void;
  readonly onPointerMove: (e: PointerEvent<SVGSVGElement>) => void;
  readonly onPointerUp: (e: PointerEvent<SVGSVGElement>) => void;
  readonly onPointerCancel: () => void;
  readonly onContextMenu: (e: MouseEvent<SVGSVGElement>) => void;
  /** The band being dragged right now, in diagram coordinates. Views draw it
   * with `<MarqueeRect>` inside their root group. */
  readonly band: Rect | undefined;
  /** Attach to the svg element: registers a non-passive wheel listener
   * (React's own onWheel is passive, so it cannot preventDefault). */
  readonly ref: (el: SVGSVGElement | null) => void;
  readonly style: { readonly touchAction: "none" };
}

function bandOf(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

export function usePointerGestures(opts: PointerGestureOptions): PointerGestureProps {
  const viewport = opts.viewport ?? { scale: 1, x: opts.padding, y: opts.padding };
  const pointer = useRef<PointerState | null>(null);
  const [band, setBand] = useState<Rect | undefined>(undefined);
  const longPress = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // latest-ref so the wheel listener (bound once via ref) sees fresh props
  const latest = useRef({ viewport, onViewportChange: opts.onViewportChange });
  latest.current = { viewport, onViewportChange: opts.onViewportChange };

  const cancelLongPress = () => {
    if (longPress.current !== undefined) clearTimeout(longPress.current);
    longPress.current = undefined;
  };
  useEffect(() => cancelLongPress, []);

  function toDiagram(e: PointerEvent<SVGSVGElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - viewport.x) / viewport.scale,
      y: (e.clientY - rect.top - viewport.y) / viewport.scale,
    };
  }

  const ref = useCallback((el: SVGSVGElement | null) => {
    if (el === null) return;
    const onWheel = (e: WheelEvent) => {
      const { viewport: v, onViewportChange } = latest.current;
      if (!onViewportChange) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * Math.exp(-e.deltaY * 0.0015)));
      // keep the diagram point under the cursor fixed while zooming
      onViewportChange({
        scale,
        x: cx - ((cx - v.x) / v.scale) * scale,
        y: cy - ((cy - v.y) / v.scale) * scale,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
  }, []);

  /** Both menu gestures land here: the id under the pointer, or null. */
  function requestMenu(target: Element, clientX: number, clientY: number) {
    const id = target.closest("[data-element-id]")?.getAttribute("data-element-id") ?? null;
    opts.selection?.onMenu?.({ id, clientX, clientY });
  }

  return {
    viewport,
    ref,
    band,
    onContextMenu: (e) => {
      if (opts.selection?.onMenu === undefined) return;
      // a canvas has no browser menu worth keeping, and a user with a mouse
      // will reach for right click before ever holding a press
      e.preventDefault();
      cancelLongPress();
      pointer.current = null;
      setBand(undefined);
      requestMenu(e.target as Element, e.clientX, e.clientY);
    },
    onPointerDown: (e) => {
      if (e.button !== 0 || !e.isPrimary) return; // left/primary pointer only
      const target = e.target as Element;
      const targetId = target.closest("[data-element-id]")?.getAttribute("data-element-id") ?? null;
      const rawKind = target.closest("[data-drag]")?.getAttribute("data-drag") ?? null;
      const { x, y } = toDiagram(e);
      pointer.current = {
        targetId,
        dragKind: rawKind !== null && opts.dragKinds.includes(rawKind) ? rawKind : null,
        screenX: e.clientX,
        screenY: e.clientY,
        diagramX: x,
        diagramY: y,
        viewport,
        active: false,
        banding: targetId === null && (opts.selection?.marqueeMode === true || e.shiftKey),
        additive: e.ctrlKey || e.metaKey || e.shiftKey,
      };
      // always capture so pointerup reaches us even outside the svg —
      // otherwise stale state produces a phantom click later
      e.currentTarget.setPointerCapture(e.pointerId);
      if (opts.selection?.onMenu !== undefined) {
        const { clientX, clientY } = e;
        cancelLongPress();
        longPress.current = setTimeout(() => {
          longPress.current = undefined;
          // the press is spent: no click, no pan, no band follows it
          pointer.current = null;
          setBand(undefined);
          requestMenu(target, clientX, clientY);
        }, LONG_PRESS_MS);
      }
    },
    onPointerMove: (e) => {
      const p = pointer.current;
      if (!p) return;
      const dx = e.clientX - p.screenX;
      const dy = e.clientY - p.screenY;
      if (!p.active && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      cancelLongPress(); // moving means this was never a long press
      p.active = true; // moved past threshold: no longer a click
      if (p.dragKind !== null && p.targetId !== null) {
        const { x, y } = toDiagram(e);
        opts.onDrag?.(p.dragKind, p.targetId, x, y);
        return;
      }
      if (p.banding) {
        const { x, y } = toDiagram(e);
        setBand(bandOf(p.diagramX, p.diagramY, x, y));
        return;
      }
      // background drag = pan
      if (p.targetId === null && opts.onViewportChange) {
        opts.onViewportChange({ scale: p.viewport.scale, x: p.viewport.x + dx, y: p.viewport.y + dy });
      }
    },
    onPointerUp: (e) => {
      const p = pointer.current;
      pointer.current = null;
      cancelLongPress();
      if (!p) return;
      if (p.active) {
        if (p.banding) {
          const { x, y } = toDiagram(e);
          setBand(undefined);
          opts.selection?.onMarquee?.(bandOf(p.diagramX, p.diagramY, x, y), p.additive);
          return;
        }
        if (p.dragKind === null || p.targetId === null) return; // a pan or swipe, not a click or drop
        const { x, y } = toDiagram(e);
        opts.onDrop?.(p.dragKind, p.targetId, x, y);
        return;
      }
      if (p.targetId !== null) opts.onElementClick?.(p.targetId, p.additive);
      else opts.onBackgroundClick?.();
    },
    onPointerCancel: () => {
      pointer.current = null;
      cancelLongPress();
      setBand(undefined);
      opts.onGestureCancel?.();
    },
    style: { touchAction: "none" },
  };
}
