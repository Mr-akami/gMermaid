import { gitLabel, resolveGitGraph, type GitBranchId, type GitCommitId, type GitCommitType, type GitDirection, type GitGraphIR } from "@gmermaid/ir";
import type { TextMeasurer, TextStyle } from "./measurer";
import type { Point, Rect } from "./result";

// A git graph is arithmetic, no dagre: commits take one slot each along the
// time axis in script order, branches take one lane each (sorted the way
// mermaid sorts them). LR runs time left to right with lanes as rows; TB
// and BT run it down / up with lanes as columns. Everything is computed once
// as TB-shaped (u = along time, v = across lanes) numbers and mapped to x/y
// at the end, so the three orientations cannot drift apart.

const LABEL_STYLE: TextStyle = { fontSize: 11, fontFamily: "sans-serif" };
const TAG_STYLE: TextStyle = { fontSize: 10, fontFamily: "sans-serif" };
const PILL_STYLE: TextStyle = { fontSize: 12, fontFamily: "sans-serif", bold: true };

const R = 10;
const PAD = 20;
const PILL_H = 24;
const PILL_PAD = 10;
const MIN_SLOT = 64;
const LANE_LR = 78;
const ROW_TB = 52;
const TAG_H = 16;
const TAG_PAD = 6;
/** Room above a node for its tag pill (LR). */
const ABOVE = 30;

export interface GitLaneBox {
  readonly id: GitBranchId;
  readonly name: string;
  readonly colorIndex: number;
  /** The branch label. */
  readonly rect: Rect;
  /** The dashed guide the commits sit on. */
  readonly line: { readonly from: Point; readonly to: Point };
}

export interface GitCommitNode {
  readonly id: GitCommitId;
  readonly kind: "commit" | "merge" | "cherryPick";
  readonly branch: GitBranchId;
  readonly colorIndex: number;
  readonly commitType: GitCommitType;
  readonly center: Point;
  readonly r: number;
  /** The node's bounding box — hit testing and the marquee. */
  readonly rect: Rect;
  readonly label: string;
  readonly labelPos: Point;
  readonly labelAnchor: "start" | "middle";
  /** Tags, joined; empty = none. */
  readonly tags: string;
  readonly tagRect?: Rect;
}

export interface GitEdge {
  readonly from: GitCommitId;
  readonly to: GitCommitId;
  /** SVG path data. */
  readonly d: string;
  readonly colorIndex: number;
  /** The cherry-pick's link to its source. */
  readonly dashed: boolean;
}

export interface GitGraphLayout {
  readonly kind: "gitGraph";
  readonly direction: GitDirection;
  readonly size: { readonly w: number; readonly h: number };
  readonly lanes: readonly GitLaneBox[];
  readonly edges: readonly GitEdge[];
  readonly commits: readonly GitCommitNode[];
}

const textW = (m: TextMeasurer, text: string, style: TextStyle): number => (text === "" ? 0 : m.measure(text, style).w);

export function layoutGitGraph(ir: GitGraphIR, measure: TextMeasurer): GitGraphLayout {
  const run = resolveGitGraph(ir);
  // the reducer and the parser never let an unrunnable script in; an empty
  // frame is the safe answer if one arrives anyway
  if (!run.ok) return { kind: "gitGraph", direction: ir.direction, size: { w: 0, h: 0 }, lanes: [], edges: [], commits: [] };

  const horizontal = ir.direction === "LR";
  const laneIndex = new Map(run.lanes.map((id, i) => [id, i] as const));
  const branchName = new Map(run.branches.map((b) => [b.id, b.name] as const));
  const stepOf = new Map(run.commits.map((c) => [c.step.id, c] as const));

  const labelOf = (c: (typeof run.commits)[number]): string => {
    const s = c.step;
    if (s.type === "cherryPick") return "";
    if (s.name !== undefined) return s.name;
    if (s.type === "merge") return `merge ${branchName.get(s.from) ?? ""}`;
    return s.message ?? "";
  };
  const tagsOf = (c: (typeof run.commits)[number]): string => {
    const s = c.step;
    if (s.type === "cherryPick" && s.tags.length === 0) {
      const src = stepOf.get(s.source)?.step;
      return `cherry-pick:${(src && gitLabel(src)) ?? ""}`.replace(/:$/, "");
    }
    return s.tags.join(", ");
  };

  const info = run.commits.map((c) => {
    const label = labelOf(c);
    const tags = tagsOf(c);
    return { c, label, tags, lw: textW(measure, label, LABEL_STYLE), tw: textW(measure, tags, TAG_STYLE) + TAG_PAD * 2 };
  });
  const pillW = new Map(run.branches.map((b) => [b.id, textW(measure, b.name, PILL_STYLE) + PILL_PAD * 2] as const));
  const maxPill = Math.max(0, ...pillW.values());
  const maxLabel = Math.max(0, ...info.map((i) => i.lw));
  const maxTag = Math.max(0, ...info.map((i) => (i.tags === "" ? 0 : i.tw)));

  // ---- u: slot centres along the time axis; v: lane centres across it
  const slotLen = (i: (typeof info)[number]): number =>
    horizontal ? Math.max(MIN_SLOT, i.lw + 16, i.tw + 12) : ROW_TB;
  const laneStart = horizontal ? PAD + maxPill + 16 : PAD + PILL_H + 16;
  const slotU: number[] = [];
  let u = laneStart;
  for (const i of info) {
    const len = slotLen(i);
    slotU.push(u + len / 2);
    u += len;
  }
  const uEnd = Math.max(u, laneStart + MIN_SLOT);
  const laneStep = horizontal ? LANE_LR : Math.max(110, maxPill + 16, maxTag + maxLabel + 2 * R + 40);
  const v0 = horizontal ? PAD + ABOVE : PAD + laneStep / 2;
  const laneV = (i: number): number => v0 + i * laneStep;

  const lastV = laneV(Math.max(0, run.lanes.length - 1));
  const total = horizontal
    ? { w: uEnd + PAD, h: lastV + R + 32 + PAD }
    : { w: lastV + laneStep / 2 + PAD, h: uEnd + PAD };

  // ---- (u, v) → x / y, flipped for BT
  const pt = (uu: number, vv: number): Point => {
    if (horizontal) return { x: uu, y: vv };
    return { x: vv, y: ir.direction === "BT" ? total.h - uu : uu };
  };
  const box = (uu: number, vv: number, w: number, h: number): Rect => {
    const c = pt(uu, vv);
    return { x: c.x - w / 2, y: c.y - h / 2, w, h };
  };

  const centers = new Map<GitCommitId, Point>();
  const commits: GitCommitNode[] = info.map(({ c, label, tags, tw }, k) => {
    const lane = laneIndex.get(c.branch) ?? 0;
    const center = pt(slotU[k]!, laneV(lane));
    centers.set(c.step.id, center);
    const tagRect = tags === ""
      ? undefined
      : horizontal
        ? { x: center.x - tw / 2, y: center.y - R - 8 - TAG_H, w: tw, h: TAG_H }
        : { x: center.x - R - 8 - tw, y: center.y - TAG_H / 2, w: tw, h: TAG_H };
    return {
      id: c.step.id,
      kind: c.step.type,
      branch: c.branch,
      colorIndex: lane,
      commitType: c.step.type === "cherryPick" ? "NORMAL" : c.step.commitType,
      center,
      r: R,
      rect: { x: center.x - R, y: center.y - R, w: 2 * R, h: 2 * R },
      label,
      labelPos: horizontal ? { x: center.x, y: center.y + R + 14 } : { x: center.x + R + 8, y: center.y },
      labelAnchor: horizontal ? "middle" : "start",
      tags,
      ...(tagRect ? { tagRect } : {}),
    };
  });

  const edges: GitEdge[] = [];
  for (const c of run.commits) {
    c.parents.forEach((p, n) => {
      const a = centers.get(p);
      const b = centers.get(c.step.id);
      if (!a || !b) return;
      const dashed = c.step.type === "cherryPick" && n === 1;
      edges.push({ from: p, to: c.step.id, d: edgePath(a, b, horizontal), colorIndex: laneIndex.get(c.branch) ?? 0, dashed });
    });
  }

  const lanes: GitLaneBox[] = run.lanes.map((id, i) => {
    const w = pillW.get(id) ?? 0;
    const vv = laneV(i);
    const rect = horizontal ? { x: PAD, y: vv - PILL_H / 2, w, h: PILL_H } : box(PAD + PILL_H / 2, vv, w, PILL_H);
    const from = pt(laneStart - 6, vv);
    const to = pt(uEnd, vv);
    return { id, name: branchName.get(id) ?? "", colorIndex: i, rect, line: { from, to } };
  });

  return { kind: "gitGraph", direction: ir.direction, size: total, lanes, edges, commits };
}

/** Straight along a lane, an S-curve between lanes. */
function edgePath(a: Point, b: Point, horizontal: boolean): string {
  if (horizontal ? a.y === b.y : a.x === b.x) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  if (horizontal) {
    const mx = (a.x + b.x) / 2;
    return `M ${a.x} ${a.y} C ${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}`;
  }
  const my = (a.y + b.y) / 2;
  return `M ${a.x} ${a.y} C ${a.x} ${my} ${b.x} ${my} ${b.x} ${b.y}`;
}
