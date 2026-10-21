// One drawn icon set for the chrome: 16px, 1.5 stroke, round joins. The
// toolbar used to borrow unicode glyphs (⤢ ▭ ⇱), which render in whatever
// font the OS picks and never line up with each other.

type IconName = "open" | "save" | "files" | "undo" | "redo" | "fit" | "marquee" | "move" | "trash" | "close";

const PATHS: Record<IconName, string> = {
  open: "M2.5 4.5v8h11v-6h-6l-1.5-2z",
  save: "M8 2.5v7m-3-3 3 3 3-3M3 11v2.5h10V11",
  files: "M3 3.5h10M3 8h10M3 12.5h6",
  undo: "M5.5 3.5 2.5 6.5l3 3M2.5 6.5h7a4 4 0 0 1 0 8H7",
  redo: "M10.5 3.5l3 3-3 3M13.5 6.5h-7a4 4 0 0 0 0 8H9",
  fit: "M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10",
  marquee: "M2.5 2.5h3M8 2.5h1.5M12 2.5h1.5v1.5M13.5 6.5v3M13.5 12v1.5H12M9.5 13.5H6.5M4 13.5H2.5V12M2.5 9.5v-3M2.5 4V2.5",
  move: "M8 1.5v13M1.5 8h13M8 1.5 6 3.5m2-2 2 2M8 14.5l-2-2m2 2 2-2M1.5 8l2-2m-2 2 2 2M14.5 8l-2-2m2 2-2 2",
  trash: "M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4",
  close: "M4 4l8 8M12 4l-8 8",
};

export function Icon({ name }: { readonly name: IconName }) {
  return (
    <svg className="icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
