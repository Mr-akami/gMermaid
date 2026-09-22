import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { marqueeHits, type DiagramLayout } from "@gmermaid/layout";
import { DIAGRAM_ROOT_ATTR, MIN_SCALE, type MenuRequest, type SelectionGestures, type Viewport } from "@gmermaid/renderer";
import type { DiagramIR } from "@gmermaid/ir";
import { copySelection, pasteInto } from "./diagramClipboard";
import { readClipboardText, writeClipboardText } from "./systemClipboard";

// The behaviour every editor shell owes the user, written once: the camera
// (ADR 0001 ViewState), the selection, the clipboard and the keys that act
// on them. Ten editors used to hold a bare `viewport` useState each and no
// keyboard at all, so a diagram bigger than the canvas opened clipped with
// no way back, and the only way to delete anything was to aim at a button.
//
// The selection lives here for the same reason. Every editor's ViewState
// held ONE `selectedId`; widening that to a set in ten places would have
// been ten chances to disagree about what Ctrl+click, a rubber band or a
// paste does. The editor still owns its `selectedId` — that is the ONE
// element the property window is about — and the shell owns everything
// else in the selection, keeping the two in step.

/** Matches the per-view `PADDING`: the gap a framed diagram keeps to the edge. */
const PADDING = 20;

export interface ContextMenuItem {
  readonly label: string;
  readonly run: () => void;
  readonly disabled?: boolean | undefined;
}

export interface OpenMenu {
  /** Client coordinates of the gesture that asked for it. */
  readonly x: number;
  readonly y: number;
  readonly items: readonly ContextMenuItem[];
}

export interface ShellSelection {
  /** Everything selected, primary first (= the editor's `selectedId`). */
  readonly ids: readonly string[];
  readonly count: number;
  /** A click from a view. Returns true when the click was selection ONLY
   * (Ctrl/Cmd/Shift held) and the editor should not also act on it. */
  click(id: string, additive: boolean): boolean;
  /** Replace the whole selection; the first id becomes the primary. */
  set(ids: readonly string[]): void;
  clear(): void;
}

export interface EditorShellOptions<IR extends DiagramIR> {
  readonly ir: IR;
  /** The current layout — what the rubber band is hit-tested against. */
  readonly layout: DiagramLayout;
  /** The editor's own primary selection (its ViewState `selectedId`). */
  readonly selectedId?: string | undefined;
  /** Make `id` the primary selection; undefined clears it. */
  readonly select: (id: string | undefined) => void;
  /** Delete every id, as ONE undo step. Undefined when the editor has
   * nothing deletable. A refusal is the editor's to report (its
   * `rejectHint`), exactly as when the Delete button is pressed. */
  readonly onDelete?: ((ids: readonly string[]) => void) | undefined;
  /** Clear the selection and any pending mode (connect, move-into, …). */
  readonly onEscape?: (() => void) | undefined;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  /** Take the diagram a paste produced. Omit it and paste is refused. */
  readonly onPaste?: ((next: IR, added: readonly string[]) => void) | undefined;
  /** Say something to the user — the editor's `rejectHint`. */
  readonly notify?: ((message: string | undefined) => void) | undefined;
  /** What "move" means for THIS diagram kind, for the context menu. A kind
   * with no meaningful move passes nothing and shows no dead entry. */
  readonly moveItems?: readonly ContextMenuItem[] | undefined;
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
  readonly selection: ShellSelection;
  /** Hand to a view's `select` prop: marquee + context-menu gestures. */
  readonly gestures: SelectionGestures;
  /** Toolbar toggle: drag on empty canvas draws a band instead of panning. */
  readonly marqueeMode: boolean;
  readonly toggleMarqueeMode: () => void;
  readonly menu: OpenMenu | undefined;
  readonly closeMenu: () => void;
  readonly copy: () => void;
  readonly cut: () => void;
  readonly paste: () => void;
  readonly deleteSelection: () => void;
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

export function useEditorShell<IR extends DiagramIR>(opts: EditorShellOptions<IR>): EditorShell {
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

  // --- selection ----------------------------------------------------------
  // `extra` is everything selected BESIDES the editor's own selectedId. The
  // shell only trusts it while the primary is still one of the ids it last
  // established — so an editor that selects something on its own (a new
  // node, a background click) silently drops the rest, which is what the
  // user means every time.
  const [extra, setExtra] = useState<readonly string[]>([]);
  const established = useRef<readonly string[]>([]);
  const primary = opts.selectedId;
  const ids = useMemo(
    () => (primary === undefined ? extra : [primary, ...extra.filter((i) => i !== primary)]),
    [primary, extra],
  );
  const idsRef = useRef(ids);
  idsRef.current = ids;

  useEffect(() => {
    if (primary !== undefined && established.current.includes(primary)) return;
    established.current = primary === undefined ? [] : [primary];
    setExtra((e) => (e.length === 0 ? e : []));
  }, [primary]);

  function setSelection(next: readonly string[]) {
    established.current = next;
    setExtra(next.slice(1));
    latest.current.select(next[0]);
  }

  const selection: ShellSelection = {
    ids,
    count: ids.length,
    click: (id, additive) => {
      if (!additive) {
        // a plain click always means "just this one"
        established.current = [id];
        setExtra([]);
        return false; // the editor still runs its own click logic
      }
      const cur = idsRef.current;
      setSelection(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
      return true;
    },
    set: setSelection,
    clear: () => setSelection([]),
  };

  // --- rubber band --------------------------------------------------------
  const [marqueeMode, setMarqueeMode] = useState(false);

  // --- context menu -------------------------------------------------------
  // only WHERE it was asked for is state; what is ON it is derived from the
  // current options every render, because the gesture that opens the menu
  // usually changes the selection the items are about
  const [menuAt, setMenuAt] = useState<{ readonly x: number; readonly y: number } | undefined>(undefined);
  const menuOpen = useRef(false);
  menuOpen.current = menuAt !== undefined;
  const closeMenu = () => setMenuAt(undefined);

  // --- clipboard ----------------------------------------------------------
  function copyNow(): boolean {
    const o = latest.current;
    const picked = idsRef.current;
    const text = copySelection(o.ir, picked);
    if (text === undefined) {
      o.notify?.(picked.length === 0 ? "コピーする要素を選んでください" : "この選択はコピーできません");
      return false;
    }
    o.notify?.(undefined);
    void writeClipboardText(text).then((r) => {
      if (!r.system) o.notify?.("システムのクリップボードを使えないため、アプリ内にコピーしました");
    });
    return true;
  }

  function pasteNow() {
    const o = latest.current;
    if (o.onPaste === undefined) {
      o.notify?.("この図種にはまだ貼り付けられません");
      return;
    }
    void readClipboardText().then(({ text, system }) => {
      const fresh = latest.current;
      if (text === undefined || text.trim() === "") {
        fresh.notify?.(
          system ? "クリップボードが空です" : "クリップボードを読み取れませんでした（ブラウザに許可されていません）",
        );
        return;
      }
      const result = pasteInto(fresh.ir, text);
      if (!result.ok) {
        fresh.notify?.(result.reason);
        return;
      }
      fresh.notify?.(undefined);
      fresh.onPaste?.(result.ir as IR, result.added);
      // what arrived is selected, so it can be moved or deleted at once
      setSelection(result.added);
    });
  }

  function deleteSelection() {
    const o = latest.current;
    const picked = idsRef.current;
    if (picked.length === 0 || o.onDelete === undefined) return;
    o.onDelete(picked);
  }

  function cutNow() {
    if (copyNow()) deleteSelection();
  }

  // --- gestures -----------------------------------------------------------
  function openMenuAt(req: MenuRequest) {
    let picked = idsRef.current;
    // the menu is about the element under the pointer — unless the pointer
    // is already inside the selection, which then stays whole
    if (req.id !== null && !picked.includes(req.id)) {
      picked = [req.id];
      setSelection(picked);
    }
    if (picked.length === 0) {
      setMenuAt(undefined); // background, nothing selected: no menu
      return;
    }
    setMenuAt({ x: req.clientX, y: req.clientY });
  }

  const menuItems: ContextMenuItem[] = [
    { label: "コピー", run: () => void copyNow() },
    // a kind with no meaningful move contributes nothing, so no dead entry
    ...(opts.moveItems ?? []),
    { label: "削除", run: deleteSelection, disabled: opts.onDelete === undefined },
  ];
  const menu: OpenMenu | undefined = menuAt === undefined ? undefined : { ...menuAt, items: menuItems };

  const gestures: SelectionGestures = {
    marqueeMode,
    onMarquee: (band, additive) => {
      const hits = marqueeHits(latest.current.layout, band);
      const cur = idsRef.current;
      setSelection(additive ? [...cur, ...hits.filter((h) => !cur.includes(h))] : hits);
    },
    onMenu: openMenuAt,
  };

  // --- keyboard -----------------------------------------------------------
  const keys = useRef({ copyNow, pasteNow, cutNow, deleteSelection, closeMenu, setMarqueeMode, idsRef });
  keys.current = { copyNow, pasteNow, cutNow, deleteSelection, closeMenu, setMarqueeMode, idsRef };

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const node = canvasRef.current;
      // only the editor on screen answers; the other nine are display:none
      if (node === null || node.offsetParent === null) return;
      // the user's own copy and paste inside a field or the code pane is
      // theirs; we never take those keys
      if (isTyping(e.target)) return;
      const { onEscape, onUndo, onRedo } = latest.current;
      const k = keys.current;
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
      if (mod && !e.altKey && (e.key === "c" || e.key === "C")) {
        if (k.idsRef.current.length === 0) return; // let the browser copy text
        e.preventDefault();
        k.copyNow();
        return;
      }
      if (mod && !e.altKey && (e.key === "x" || e.key === "X")) {
        if (k.idsRef.current.length === 0) return;
        e.preventDefault();
        k.cutNow();
        return;
      }
      if (mod && !e.altKey && (e.key === "v" || e.key === "V")) {
        e.preventDefault();
        k.pasteNow();
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (latest.current.onDelete === undefined) return;
        e.preventDefault(); // Backspace outside a field would navigate back
        k.deleteSelection();
        return;
      }
      if (e.key === "Escape") {
        // an open menu is the innermost thing Escape can dismiss; it does
        // not also throw away the selection the menu is about
        if (menuOpen.current) {
          k.closeMenu();
          return;
        }
        k.setMarqueeMode(false);
        onEscape?.();
      }
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
    selection,
    gestures,
    marqueeMode,
    toggleMarqueeMode: () => setMarqueeMode((m) => !m),
    menu,
    closeMenu,
    copy: () => void copyNow(),
    cut: cutNow,
    paste: pasteNow,
    deleteSelection,
  };
}
