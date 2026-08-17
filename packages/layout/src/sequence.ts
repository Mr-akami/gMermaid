import type { LifelineId, SequenceEvent, SequenceIR } from "@gmermaid/ir";
import type { TextMeasurer } from "./measurer";
import type {
  BranchBand,
  DropSlot,
  FragmentFrame,
  LifelineColumn,
  MessageRow,
  NoteBox,
  SequenceLayout,
} from "./sequenceResult";

const FONT = { fontSize: 13, fontFamily: "sans-serif" } as const;
const HEAD_H = 36;
const HEAD_PAD_X = 14;
const HEAD_MIN_W = 70;
const TOP_MARGIN = 10;
const SIDE_MARGIN = 20;
const ROW_H = 38;
const FIRST_ROW_GAP = 28;
// The first branch condition sits BESIDE the label tab (top of the frame),
// so the first message row only needs to clear that single header line.
const FRAG_TOP = 40;
const NOTE_PAD = 8;
const NOTE_GAP = 12;
const FRAG_BOTTOM = 10;
const FRAG_GAP_AFTER = 16;
const FRAG_DIVIDER = 38;
const FRAG_SIDE_PAD = 20; // frame padding around its involved lifelines
const FRAG_NEST_PAD = 12; // extra margin a parent keeps around child frames
const SELF_MSG_EXTRA = 14;
const MIN_GAP = 60;
const BOTTOM_MARGIN = 24;

function eachMessage(
  events: readonly SequenceEvent[],
  fn: (m: Extract<SequenceEvent, { kind: "message" }>) => void,
): void {
  for (const e of events) {
    if (e.kind === "message") fn(e);
    else if (e.kind === "fragment") for (const b of e.branches) eachMessage(b.events, fn);
  }
}

export function layoutSequence(ir: SequenceIR, measure: TextMeasurer): SequenceLayout {
  // --- horizontal: lifeline columns -------------------------------------
  const headW = new Map<LifelineId, number>();
  for (const l of ir.lifelines) {
    const w = measure.measure(l.name, FONT).w + HEAD_PAD_X * 2;
    headW.set(l.id, Math.max(HEAD_MIN_W, w));
  }

  // required gap between adjacent columns: widest message label crossing it
  const index = new Map<LifelineId, number>(ir.lifelines.map((l, i) => [l.id, i]));
  const gaps: number[] = Array.from({ length: Math.max(0, ir.lifelines.length - 1) }, () => MIN_GAP);
  eachMessage(ir.events, (m) => {
    const a = index.get(m.from);
    const b = index.get(m.to);
    if (a === undefined || b === undefined || a === b) return;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const span = hi - lo;
    const need = (measure.measure(m.label, FONT).w + 24) / span;
    for (let g = lo; g < hi; g++) gaps[g] = Math.max(gaps[g]!, need);
  });

  const xs: number[] = [];
  let x = SIDE_MARGIN;
  for (let i = 0; i < ir.lifelines.length; i++) {
    const w = headW.get(ir.lifelines[i]!.id)!;
    if (i === 0) {
      x += w / 2;
    } else {
      const prevW = headW.get(ir.lifelines[i - 1]!.id)!;
      x += prevW / 2 + gaps[i - 1]! + w / 2;
    }
    xs.push(x);
  }
  const colX = new Map<LifelineId, number>(ir.lifelines.map((l, i) => [l.id, xs[i]!]));

  // --- vertical: walk events --------------------------------------------
  const messages: MessageRow[] = [];
  const fragments: FragmentFrame[] = [];
  const notes: NoteBox[] = [];
  const slots: DropSlot[] = [];
  let y = TOP_MARGIN + HEAD_H + FIRST_ROW_GAP;
  let msgCount = 0; // autonumber walks messages in document order

  const lifelinesOf = (events: readonly SequenceEvent[]): Set<LifelineId> => {
    const s = new Set<LifelineId>();
    eachMessage(events, (m) => {
      s.add(m.from);
      s.add(m.to);
    });
    return s;
  };

  const walk = (
    events: readonly SequenceEvent[],
    depth: number,
    container: DropSlot["container"],
  ): void => {
    let idx = 0;
    // per-container: a note only anchors to a message that is its DIRECT
    // preceding sibling — never across fragment borders or branch dividers
    let lastMessage: { x: number; y: number } | null = null;
    for (const e of events) {
      slots.push({ container, index: idx, y: y - ROW_H / 2 });
      idx += 1;
      if (e.kind === "message") {
        const fromX = colX.get(e.from) ?? 0;
        const toX = colX.get(e.to) ?? 0;
        messages.push({
          id: e.id,
          fromX,
          toX,
          y,
          label: e.label,
          labelPos: { x: (fromX + toX) / 2, y: y - 8 },
          arrow: e.arrow,
          ...(ir.autonumber !== undefined ? { seq: ir.autonumber.start + msgCount++ * ir.autonumber.step } : {}),
        });
        y += ROW_H + (e.from === e.to ? SELF_MSG_EXTRA : 0);
        lastMessage = { x: (fromX + toX) / 2, y: messages[messages.length - 1]!.y };
        continue;
      }

      if (e.kind === "note") {
        const m = measure.measure(e.text, FONT);
        const w = m.w + NOTE_PAD * 2;
        const noteH = Math.max(26, m.h + NOTE_PAD * 2);
        const refXs = e.lifelines.map((id) => colX.get(id) ?? SIDE_MARGIN);
        const lo = Math.min(...refXs);
        const hi = Math.max(...refXs);
        let bx: number;
        if (e.position === "leftOf") bx = lo - 14 - w;
        else if (e.position === "rightOf") bx = hi + 14;
        else bx = (lo + hi) / 2 - w / 2;
        const rect = { x: bx, y: y - 14, w, h: noteH };
        notes.push({
          id: e.id,
          rect,
          text: e.text,
          position: e.position,
          ...(lastMessage !== null
            ? { anchor: { x1: bx + w / 2, y1: rect.y, x2: lastMessage.x, y2: lastMessage.y } }
            : {}),
        });
        y += noteH + NOTE_GAP;
        lastMessage = null;
        continue;
      }
      lastMessage = null;

      // Frames are sized bottom-up: children are laid out first, then the
      // parent hugs its involved lifelines AND encloses every child frame
      // with a small nesting margin — so nested fragments never poke out,
      // and a frame stays narrow enough not to cover uninvolved lifelines.
      const top = y;
      y += FRAG_TOP;
      const childStart = fragments.length;
      const branchMeta: { id: BranchBand["id"]; condition: string; dividerY?: number; condY: number }[] = [];
      e.branches.forEach((branch, bi) => {
        if (bi > 0) {
          const dividerY = y + 4;
          y += FRAG_DIVIDER;
          branchMeta.push({ id: branch.id, condition: branch.condition, dividerY, condY: dividerY + 17 });
        } else {
          branchMeta.push({ id: branch.id, condition: branch.condition, condY: top + 14 });
        }
        walk(branch.events, depth + 1, { kind: "branch", branchId: branch.id });
      });
      y += FRAG_BOTTOM;

      const involved = lifelinesOf(e.branches.flatMap((b) => [...b.events]));
      const involvedXs =
        involved.size > 0
          ? [...involved].map((id) => colX.get(id) ?? 0)
          : xs.length > 0
            ? xs
            : [SIDE_MARGIN, SIDE_MARGIN + 200];
      let left = Math.min(...involvedXs) - FRAG_SIDE_PAD;
      let right = Math.max(...involvedXs) + FRAG_SIDE_PAD;
      // fragments pushed while walking the branches are this frame's
      // descendants (children push before their parent)
      for (let ci = childStart; ci < fragments.length; ci++) {
        const c = fragments[ci]!;
        left = Math.min(left, c.rect.x - FRAG_NEST_PAD);
        right = Math.max(right, c.rect.x + c.rect.w + FRAG_NEST_PAD);
      }

      const branches: BranchBand[] = branchMeta.map((b) => ({
        id: b.id,
        condition: b.condition,
        conditionPos: { x: b.dividerY !== undefined ? left + 10 : left + 52, y: b.condY },
        ...(b.dividerY !== undefined ? { dividerY: b.dividerY } : {}),
      }));

      fragments.push({
        id: e.id,
        fragmentKind: e.fragmentKind,
        rect: { x: left, y: top, w: right - left, h: y - top },
        labelTab: { x: left, y: top, w: 44, h: 20 },
        branches,
        depth,
      });
      y += FRAG_GAP_AFTER; // keep the next row clear of the closing border
    }
    // trailing slot: drop at the end of this container
    slots.push({ container, index: idx, y: y - ROW_H / 2 + 4 });
  };
  walk(ir.events, 0, { kind: "root" });

  const spineBottom = y + 6;
  const lifelines: LifelineColumn[] = ir.lifelines.map((l) => {
    const w = headW.get(l.id)!;
    const cx = colX.get(l.id)!;
    return {
      id: l.id,
      name: l.name,
      isActor: l.isActor,
      x: cx,
      headRect: { x: cx - w / 2, y: TOP_MARGIN, w, h: HEAD_H },
      spineTop: TOP_MARGIN + HEAD_H,
      spineBottom,
    };
  });

  const lastX = ir.lifelines.length > 0 ? xs[xs.length - 1]! + headW.get(ir.lifelines[ir.lifelines.length - 1]!.id)! / 2 : 200;
  const fragRight = fragments.reduce((m, f) => Math.max(m, f.rect.x + f.rect.w), 0);
  const noteRight = notes.reduce((m, n) => Math.max(m, n.rect.x + n.rect.w), 0);
  return {
    kind: "sequence",
    size: { w: Math.max(lastX, fragRight, noteRight) + SIDE_MARGIN, h: spineBottom + BOTTOM_MARGIN },
    lifelines,
    messages,
    fragments,
    notes,
    slots,
  };
}
