import type { LifelineId, SequenceEvent, SequenceIR } from "@gmermaid/ir";
import type { TextMeasurer } from "./measurer";
import type {
  ActivationBar,
  BoxFrame,
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
// `rect` has no label tab or condition row, so its body starts higher.
const RECT_TOP = 14;
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
const BAR_W = 10;
const BAR_NEST = 5; // x shift per nesting level of the activation stack
const BAR_MIN_H = 16;
const ACT_ROW = 14; // vertical room a standalone activate/deactivate takes
const BOX_PAD = 10;
const BOX_LABEL_H = 22;
const DESTROY_ROW = 20;

function eachMessage(
  events: readonly SequenceEvent[],
  fn: (m: Extract<SequenceEvent, { kind: "message" }>) => void,
): void {
  for (const e of events) {
    if (e.kind === "message") fn(e);
    else if (e.kind === "fragment") for (const b of e.branches) eachMessage(b.events, fn);
  }
}

/** Every lifeline an event subtree touches — what a fragment frame spans. */
function lifelinesOf(events: readonly SequenceEvent[]): Set<LifelineId> {
  const out = new Set<LifelineId>();
  const walk = (list: readonly SequenceEvent[]): void => {
    for (const e of list) {
      if (e.kind === "message") {
        out.add(e.from);
        out.add(e.to);
      } else if (e.kind === "note") for (const id of e.lifelines) out.add(id);
      else if (e.kind === "fragment") for (const b of e.branches) walk(b.events);
      else out.add(e.lifeline);
    }
  };
  walk(events);
  return out;
}

export function layoutSequence(ir: SequenceIR, measure: TextMeasurer): SequenceLayout {
  // Multi-line text (`<br/>` in the mermaid source) measures line by line:
  // the renderer draws one <tspan> per line, so height grows with the count.
  const block = (text: string): { w: number; h: number; lines: number } => {
    const parts = text.split("\n");
    let w = 0;
    let h = 0;
    for (const part of parts) {
      const m = measure.measure(part, FONT);
      w = Math.max(w, m.w);
      h += m.h;
    }
    return { w, h, lines: parts.length };
  };

  // --- horizontal: lifeline columns -------------------------------------
  const headW = new Map<LifelineId, number>();
  for (const l of ir.lifelines) {
    const w = block(l.name).w + HEAD_PAD_X * 2;
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
    const need = (block(m.label).w + 24) / span;
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

  // boxes need a title band above the heads, so everything moves down
  const headTop = TOP_MARGIN + (ir.boxes.length > 0 ? BOX_LABEL_H : 0);

  // --- vertical: walk events --------------------------------------------
  const messages: MessageRow[] = [];
  const fragments: FragmentFrame[] = [];
  const notes: NoteBox[] = [];
  const slots: DropSlot[] = [];
  const activations: ActivationBar[] = [];
  // open activation bars per lifeline: the stack depth IS the nesting offset
  const openBars = new Map<LifelineId, number[]>();
  const createdAt = new Map<LifelineId, number>();
  const destroyedAt = new Map<LifelineId, number>();
  let y = headTop + HEAD_H + FIRST_ROW_GAP;
  let msgCount = 0; // autonumber walks messages in document order

  const pushBar = (id: LifelineId, at: number): void => {
    const stack = openBars.get(id) ?? [];
    stack.push(at);
    openBars.set(id, stack);
  };
  const popBar = (id: LifelineId, at: number): void => {
    const stack = openBars.get(id);
    const from = stack?.pop();
    if (from === undefined) return;
    const cx = colX.get(id) ?? 0;
    const depth = stack!.length;
    activations.push({
      lifeline: id,
      rect: { x: cx - BAR_W / 2 + depth * BAR_NEST, y: from, w: BAR_W, h: Math.max(BAR_MIN_H, at - from) },
      depth,
    });
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
        const label = block(e.label);
        const lineH = label.h / label.lines;
        const extra = (label.lines - 1) * lineH; // extra lines grow upwards
        if (e.activate === "start") pushBar(e.to, y);
        messages.push({
          id: e.id,
          fromX,
          toX,
          y,
          label: e.label,
          labelPos: { x: (fromX + toX) / 2, y: y - 8 - extra },
          arrow: e.arrow,
          ...(ir.autonumber !== undefined ? { seq: ir.autonumber.start + msgCount++ * ir.autonumber.step } : {}),
        });
        if (e.activate === "end") popBar(e.from, y);
        y += ROW_H + (e.from === e.to ? SELF_MSG_EXTRA : 0) + extra;
        lastMessage = { x: (fromX + toX) / 2, y: messages[messages.length - 1]!.y };
        continue;
      }

      if (e.kind === "activation") {
        if (e.on) pushBar(e.lifeline, y);
        else popBar(e.lifeline, y);
        y += ACT_ROW;
        lastMessage = null;
        continue;
      }

      if (e.kind === "create") {
        // the head is drawn at this row; the rows below must clear it
        createdAt.set(e.lifeline, y);
        y += HEAD_H + 10;
        lastMessage = null;
        continue;
      }

      if (e.kind === "destroy") {
        destroyedAt.set(e.lifeline, y);
        y += DESTROY_ROW;
        lastMessage = null;
        continue;
      }

      if (e.kind === "note") {
        const m = block(e.text);
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
      const isRect = e.fragmentKind === "rect";
      const top = y;
      y += isRect ? RECT_TOP : FRAG_TOP;
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
      y += isRect ? RECT_TOP : FRAG_BOTTOM;

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
        // the rect's fill color rides on its single branch (see IR docs)
        ...(isRect ? { fill: e.branches[0]?.condition ?? "" } : {}),
        branches: isRect ? [] : branches,
        depth,
      });
      y += FRAG_GAP_AFTER; // keep the next row clear of the closing border
    }
    // trailing slot: drop at the end of this container
    slots.push({ container, index: idx, y: y - ROW_H / 2 + 4 });
  };
  walk(ir.events, 0, { kind: "root" });

  const spineBottom = y + 6;
  // bars still open at the end run to the spine's end (mermaid does the same)
  for (const [id, stack] of openBars) {
    while (stack.length > 0) popBar(id, destroyedAt.get(id) ?? spineBottom);
  }

  const lifelines: LifelineColumn[] = ir.lifelines.map((l) => {
    const w = headW.get(l.id)!;
    const cx = colX.get(l.id)!;
    const created = createdAt.get(l.id);
    const destroyed = destroyedAt.get(l.id);
    const top = created ?? headTop;
    return {
      id: l.id,
      name: l.name,
      kind: l.kind,
      x: cx,
      headRect: { x: cx - w / 2, y: top, w, h: HEAD_H },
      spineTop: top + HEAD_H,
      spineBottom: destroyed ?? spineBottom,
      ...(created !== undefined ? { created: true } : {}),
      ...(destroyed !== undefined ? { destroyed: true } : {}),
    };
  });

  const boxes: BoxFrame[] = [];
  for (const b of ir.boxes) {
    const cols = lifelines.filter((l) => b.lifelines.includes(l.id));
    if (cols.length === 0) continue;
    const left = Math.min(...cols.map((c) => c.headRect.x)) - BOX_PAD;
    const right = Math.max(...cols.map((c) => c.headRect.x + c.headRect.w)) + BOX_PAD;
    boxes.push({
      id: b.id,
      name: b.name,
      ...(b.color !== undefined ? { color: b.color } : {}),
      rect: { x: left, y: TOP_MARGIN, w: right - left, h: BOX_LABEL_H + HEAD_H + BOX_PAD },
      labelPos: { x: (left + right) / 2, y: TOP_MARGIN + BOX_LABEL_H / 2 },
    });
  }

  const lastX = ir.lifelines.length > 0 ? xs[xs.length - 1]! + headW.get(ir.lifelines[ir.lifelines.length - 1]!.id)! / 2 : 200;
  const fragRight = fragments.reduce((m, f) => Math.max(m, f.rect.x + f.rect.w), 0);
  const noteRight = notes.reduce((m, n) => Math.max(m, n.rect.x + n.rect.w), 0);
  const boxRight = boxes.reduce((m, b) => Math.max(m, b.rect.x + b.rect.w), 0);
  return {
    kind: "sequence",
    size: { w: Math.max(lastX, fragRight, noteRight, boxRight) + SIDE_MARGIN, h: spineBottom + BOTTOM_MARGIN },
    lifelines,
    boxes,
    activations,
    messages,
    fragments,
    notes,
    slots,
  };
}
