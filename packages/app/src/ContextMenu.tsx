import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { OpenMenu } from "./useEditorShell";

// The menu a long press or a right click opens. It is an HTML overlay in
// CLIENT coordinates, never part of the diagram: it must not scale with the
// camera, and it must stay whole when it is opened against the edge of the
// window — so it is placed, measured, and nudged back inside.

const EDGE = 4;

export function ContextMenu({ menu, onClose }: { readonly menu: OpenMenu; readonly onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState({ x: menu.x, y: menu.y });

  // measure once it is on screen: a menu opened near the bottom-right would
  // otherwise hang off the viewport with its items unreachable
  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const { width, height } = node.getBoundingClientRect();
    setAt({
      x: Math.max(EDGE, Math.min(menu.x, window.innerWidth - width - EDGE)),
      y: Math.max(EDGE, Math.min(menu.y, window.innerHeight - height - EDGE)),
    });
  }, [menu]);

  useEffect(() => {
    const onDown = (e: Event) => {
      if (ref.current?.contains(e.target as Node) === true) return;
      onClose();
    };
    // capture, so a click that lands on the canvas closes the menu before
    // the canvas reads it as "select nothing"
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div
      className="context-menu"
      role="menu"
      aria-label="選択中の要素"
      ref={ref}
      style={{ left: at.x, top: at.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          type="button"
          disabled={item.disabled === true}
          onClick={() => {
            onClose();
            item.run();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
