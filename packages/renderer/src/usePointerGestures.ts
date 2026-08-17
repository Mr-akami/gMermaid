import { useCallback, useRef, type PointerEvent } from "react";

/** Pan/zoom state (ViewState, ADR 0001): applied as a transform on the SVG
 * root group — changing it never triggers a relayout. */
export interface Viewport {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;

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
  readonly onElementClick?: ((id: string) => void) | undefined;
  readonly onBackgroundClick?: (() => void) | undefined;
  /** Live drag past the threshold, in diagram coordinates. */
  readonly onDrag?: ((kind: string, id: string, x: number, y: number) => void) | undefined;
  readonly onDrop?: ((kind: string, id: string, x: number, y: number) => void) | undefined;
  readonly onGestureCancel?: (() => void) | undefined;
}

interface PointerState {
  targetId: string | null;
  dragKind: string | null;
  /** screen-space press point: the click threshold must not shrink when zoomed out */
  screenX: number;
  screenY: number;
  /** viewport at press time, for panning */
  viewport: Viewport;
  active: boolean;
}

const DRAG_THRESHOLD = 5;

export interface PointerGestureProps {
  readonly viewport: Viewport;
  readonly onPointerDown: (e: PointerEvent<SVGSVGElement>) => void;
  readonly onPointerMove: (e: PointerEvent<SVGSVGElement>) => void;
  readonly onPointerUp: (e: PointerEvent<SVGSVGElement>) => void;
  readonly onPointerCancel: () => void;
  /** Attach to the svg element: registers a non-passive wheel listener
   * (React's own onWheel is passive, so it cannot preventDefault). */
  readonly ref: (el: SVGSVGElement | null) => void;
  readonly style: { readonly touchAction: "none" };
}

export function usePointerGestures(opts: PointerGestureOptions): PointerGestureProps {
  const viewport = opts.viewport ?? { scale: 1, x: opts.padding, y: opts.padding };
  const pointer = useRef<PointerState | null>(null);
  // latest-ref so the wheel listener (bound once via ref) sees fresh props
  const latest = useRef({ viewport, onViewportChange: opts.onViewportChange });
  latest.current = { viewport, onViewportChange: opts.onViewportChange };

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

  return {
    viewport,
    ref,
    onPointerDown: (e) => {
      if (e.button !== 0 || !e.isPrimary) return; // left/primary pointer only
      const target = e.target as Element;
      const targetId = target.closest("[data-element-id]")?.getAttribute("data-element-id") ?? null;
      const rawKind = target.closest("[data-drag]")?.getAttribute("data-drag") ?? null;
      pointer.current = {
        targetId,
        dragKind: rawKind !== null && opts.dragKinds.includes(rawKind) ? rawKind : null,
        screenX: e.clientX,
        screenY: e.clientY,
        viewport,
        active: false,
      };
      // always capture so pointerup reaches us even outside the svg —
      // otherwise stale state produces a phantom click later
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e) => {
      const p = pointer.current;
      if (!p) return;
      const dx = e.clientX - p.screenX;
      const dy = e.clientY - p.screenY;
      if (!p.active && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      p.active = true; // moved past threshold: no longer a click
      if (p.dragKind !== null && p.targetId !== null) {
        const { x, y } = toDiagram(e);
        opts.onDrag?.(p.dragKind, p.targetId, x, y);
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
      if (!p) return;
      if (p.active) {
        if (p.dragKind === null || p.targetId === null) return; // a pan or swipe, not a click or drop
        const { x, y } = toDiagram(e);
        opts.onDrop?.(p.dragKind, p.targetId, x, y);
        return;
      }
      if (p.targetId !== null) opts.onElementClick?.(p.targetId);
      else opts.onBackgroundClick?.();
    },
    onPointerCancel: () => {
      pointer.current = null;
      opts.onGestureCancel?.();
    },
    style: { touchAction: "none" },
  };
}
