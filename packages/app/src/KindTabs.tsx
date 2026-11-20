import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DIAGRAMS, type DiagramKind } from "./diagrams";
import { Icon } from "./icons";

// The diagram-kind strip. Thirteen kinds do not fit beside the app-bar
// actions at most widths, and a strip that just scrolled hid four of them
// behind an edge nobody noticed. Tabs that do not fit fold into a "More"
// menu instead; the active kind is always on the strip, taking the last
// visible slot when it would otherwise be folded away.

const GAP = 2;

export function KindTabs({ kind, onSelect }: { readonly kind: DiagramKind; readonly onSelect: (k: DiagramKind) => void }) {
  const navRef = useRef<HTMLElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState<number>(DIAGRAMS.length);
  const [menuOpen, setMenuOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // How many tabs fit: measured off an invisible copy of the whole strip, so
  // the visible one can fold without changing what is measured.
  useLayoutEffect(() => {
    const nav = navRef.current;
    const ruler = measureRef.current;
    if (nav === null || ruler === null) return;
    const recompute = () => {
      const widths = [...ruler.children].map((c) => (c as HTMLElement).offsetWidth);
      const more = widths.pop() ?? 0; // the ruler's last child is a sample "More" button
      const room = nav.clientWidth;
      const total = widths.reduce((a, w) => a + w + GAP, 0) - GAP;
      if (total <= room) return setFit(widths.length);
      let used = more;
      let n = 0;
      while (n < widths.length && used + GAP + widths[n]! <= room) {
        used += GAP + widths[n]!;
        n++;
      }
      setFit(Math.max(1, n));
    };
    recompute();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(recompute);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  const activeIndex = DIAGRAMS.findIndex((d) => d.kind === kind);
  const shown = DIAGRAMS.slice(0, fit).map((d) => d.kind);
  if (activeIndex >= fit) shown[fit - 1] = kind;
  const folded = DIAGRAMS.filter((d) => !shown.includes(d.kind));

  // the menu closes on a pick, Esc, or a press anywhere else
  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !moreRef.current?.contains(t)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        moreRef.current?.focus();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
        next?.focus();
        e.preventDefault();
      }
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <nav className="kind-tabs" aria-label="Diagram kind" ref={navRef}>
      <div className="kind-tabs-ruler" ref={measureRef} aria-hidden="true">
        {DIAGRAMS.map((d) => (
          <span key={d.kind} className="kind-tab">
            {d.label}
          </span>
        ))}
        <span className="kind-tab kind-more">
          More
          <Icon name="chevron" />
        </span>
      </div>
      {DIAGRAMS.filter((d) => shown.includes(d.kind)).map((d) => (
        <button key={d.kind} className="kind-tab" aria-current={kind === d.kind ? "page" : undefined} onClick={() => onSelect(d.kind)}>
          {d.label}
        </button>
      ))}
      {folded.length > 0 && (
        <div className="kind-more-wrap">
          <button
            ref={moreRef}
            className="kind-tab kind-more"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={`${folded.length} more diagram kinds`}
            onClick={() => setMenuOpen((o) => !o)}
          >
            More
            <Icon name="chevron" />
          </button>
          {menuOpen && (
            <div className="kind-menu" role="menu" ref={menuRef}>
              {folded.map((d) => (
                <button
                  key={d.kind}
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onSelect(d.kind);
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
