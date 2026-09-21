import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { DIAGRAM_ROOT_ATTR, MIN_SCALE, type Viewport } from "@gmermaid/renderer";

// The behaviour every editor shell owes the user, written once: the camera
// (ADR 0001 ViewState) and the keys that act on the selection. Ten editors
// used to hold a bare `viewport` useState each and no keyboard at all, so a
// diagram bigger than the canvas opened clipped with no way back, and the
// only way to delete anything was to aim at a button.

/** Matches the per-view `PADDING`: the gap a framed diagram keeps to the edge. */
const PADDING = 20;

export interface EditorShellOptions {
  /** Delete the selection. Undefined when nothing deletable is selected —
   * the same guard the Delete button carries. A refusal is the editor's to
   * report (its `rejectHint`), exactly as when the button is pressed. */
  readonly onDelete?: (() => void) | undefined;
  /** Clear the selection and any pending mode (connect, move-into, …). */
  readonly onEscape?: (() => void) | undefined;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}

export interface EditorShell {
  /** Attach to the `.canvas` element: it is both the frame to fit into and
   * how the shell knows whether its editor is the visible one. */
  readonly canvasRef: RefObject<HTMLDivElement | null>;
  readonly viewport: Viewport | undefined;
  readonly setViewport: (v: Viewport) => void;
  /** Frame the whole diagram now — the Fit control. */
  readonly fitView: () => void;
  /** Frame it as soon as the next layout is on screen. For a diagram that
   * was REPLACED (file opened, Files panel pick, sample restored); never for
   * an edit, or a user zoomed into one corner would be yanked back on every
   * keystroke. */
  readonly fitOnNextLayout: () => void;
}

/** Viewport that frames `box` (the drawn extent, in diagram coordinates)
 * inside `rect`: shrink a diagram that does not fit, and park its top-left
 * corner at the padding origin.
 *
 * It never magnifies — a small diagram keeps the scale it was drawn at rather
 * than being blown up to fill the canvas — so a diagram that already fits and
 * starts at the origin gets exactly the default framing back. Nor does it
 * centre: the diagram grows from that corner as the user edits, and a camera
 * centred on the SMALLER diagram it was framed with would let the new parts
 * drift off the edge (re-framing on every edit is not an option — it would
 * yank a user who has zoomed into one corner). */
function frame(box: { x: number; y: number; w: number; h: number }, rect: { width: number; height: number }): Viewport {
  const w = Math.max(box.w, 1);
  const h = Math.max(box.h, 1);
  const raw = Math.min((rect.width - PADDING * 2) / w, (rect.height - PADDING * 2) / h);
  const scale = Math.min(1, Math.max(MIN_SCALE, raw));
  return { scale, x: PADDING - box.x * scale, y: PADDING - box.y * scale };
}

/** What the view actually drew, in diagram coordinates. */
function drawnExtent(canvas: HTMLElement): { x: number; y: number; w: number; h: number } | undefined {
  const root = canvas.querySelector(`svg [${DIAGRAM_ROOT_ATTR}]`);
  if (!(root instanceof SVGGraphicsElement) || typeof root.getBBox !== "function") return undefined;
  try {
    const b = root.getBBox();
    return b.width === 0 && b.height === 0 ? undefined : { x: b.x, y: b.y, w: b.width, h: b.height };
  } catch {
    return undefined; // no layout box yet (detached or display:none)
  }
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // the code pane is a contenteditable, property fields are inputs
  return target.isContentEditable || target.closest("input, textarea, select") !== null;
}

export function useEditorShell(opts: EditorShellOptions): EditorShell {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Viewport | undefined>(undefined);
  // start framed: the first layout is a diagram the user did not place
  const pending = useRef(true);
  const [, bump] = useState(0);

  // No dependency list on purpose: a pending fit has to wait for a canvas
  // with a real size, and an editor in a hidden tab has none until the tab
  // is shown (all ten stay mounted).
  useLayoutEffect(() => {
    if (!pending.current) return;
    const node = canvasRef.current;
    if (node === null) return;
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const box = drawnExtent(node);
    pending.current = false;
    // an empty diagram has nothing to frame: the plain default will do
    setViewport(box === undefined ? { scale: 1, x: PADDING, y: PADDING } : frame(box, rect));
  });

  // latest-ref: the handlers are fresh closures every render, the listener
  // is registered once
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const node = canvasRef.current;
      // only the editor on screen answers; the other nine are display:none
      if (node === null || node.offsetParent === null) return;
      if (isTyping(e.target)) return;
      const { onDelete, onEscape, onUndo, onRedo } = latest.current;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) onRedo();
        else onUndo();
        return;
      }
      if (mod && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        onRedo();
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (onDelete === undefined) return;
        e.preventDefault(); // Backspace outside a field would navigate back
        onDelete();
        return;
      }
      if (e.key === "Escape") onEscape?.();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return {
    canvasRef,
    viewport,
    setViewport,
    fitView: () => {
      pending.current = true;
      bump((n) => n + 1); // nothing else is changing: ask for the render ourselves
    },
    fitOnNextLayout: () => {
      pending.current = true;
    },
  };
}
