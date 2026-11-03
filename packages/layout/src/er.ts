import dagre from "@dagrejs/dagre";
import type { AttributeId, EntityId, ErCardinality, ErIR, RelationId } from "@gmermaid/ir";
import { collisionIndex } from "./collision";
import { placeSelfLoopLabel } from "./compound";
import { edgeLabelSize } from "./measurer";
import type { TextMeasurer } from "./measurer";
import type { Point, Rect } from "./result";

const TITLE_FONT = { fontSize: 14, fontFamily: "sans-serif", bold: true } as const;
const BODY_FONT = { fontSize: 12, fontFamily: "sans-serif" } as const;
const PAD_X = 10;
const PAD_Y = 8;
const ROW_H = 20;
const COL_GAP = 12;
const MIN_W = 120;
// self-relationship detour geometry (right side of the entity)
const SELF_W = 36;
const SELF_H = 26;
const SELF_STEP = 14;

export interface ErAttributeRow {
  readonly id: AttributeId;
  /** Centre line of the row. */
  readonly y: number;
  readonly type: string;
  readonly name: string;
  /** `PK, FK` — empty when no key. */
  readonly keys: string;
  readonly comment: string;
}

export interface ErEntityBox {
  readonly id: EntityId;
  readonly rect: Rect;
  /** Heading: the alias when there is one, else the name. */
  readonly title: string;
  readonly rows: readonly ErAttributeRow[];
  /** y of the line under the title. */
  readonly headerBottom: number;
  /** x of each column's left edge: type, name, keys, comment. */
  readonly columns: readonly [number, number, number, number];
}

export interface ErEdge {
  readonly id: RelationId;
  /** First point is on the `from` entity, last on the `to` entity. */
  readonly points: readonly Point[];
  readonly fromCard: ErCardinality;
  readonly toCard: ErCardinality;
  readonly identifying: boolean;
  readonly label: string;
  readonly labelPos: Point;
}

export interface ErLayout {
  readonly kind: "er";
  readonly size: { readonly w: number; readonly h: number };
  readonly boxes: readonly ErEntityBox[];
  readonly edges: readonly ErEdge[];
}

export function layoutEr(ir: ErIR, measure: TextMeasurer): ErLayout {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: ir.direction ?? "TB", nodesep: 60, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));

  const geom = new Map<string, { headerH: number; cols: [number, number, number, number]; widths: number[] }>();
  for (const e of ir.entities) {
    const title = e.alias ?? e.name;
    const keys = e.attributes.map((a) => a.keys.join(", "));
    const width = (texts: readonly string[]): number => Math.max(0, ...texts.map((t) => measure.measure(t, BODY_FONT).w));
    const w = [
      width(e.attributes.map((a) => a.type)),
      width(e.attributes.map((a) => a.name)),
      width(keys),
      width(e.attributes.map((a) => a.comment ?? "")),
    ];
    const used = w.filter((x) => x > 0);
    const rowsW = used.reduce((s, x) => s + x, 0) + Math.max(0, used.length - 1) * COL_GAP;
    const headerH = PAD_Y * 2 + measure.measure(title, TITLE_FONT).h;
    const bodyH = e.attributes.length === 0 ? 0 : PAD_Y + e.attributes.length * ROW_H;
    const boxW = Math.max(MIN_W, measure.measure(title, TITLE_FONT).w + PAD_X * 2, rowsW + PAD_X * 2);
    // columns left to right; an empty column takes no room
    let x = PAD_X;
    const cols: number[] = [];
    for (const cw of w) {
      cols.push(x);
      if (cw > 0) x += cw + COL_GAP;
    }
    geom.set(e.id, { headerH, cols: cols as [number, number, number, number], widths: w });
    g.setNode(e.id, { width: boxW, height: headerH + bodyH });
  }

  for (const r of ir.relationships) {
    if (!g.hasNode(r.from) || !g.hasNode(r.to)) {
      throw new Error(`layoutEr: relationship ${r.id} references a missing entity`);
    }
    // dagre cannot route self-edges — synthesized after layout as a detour
    if (r.from !== r.to) g.setEdge(r.from, r.to, edgeLabelSize(r.label ?? "", measure, BODY_FONT), r.id);
  }

  dagre.layout(g);

  const boxes: ErEntityBox[] = ir.entities.map((e) => {
    const pos = g.node(e.id);
    const parts = geom.get(e.id)!;
    const x = pos.x - pos.width / 2;
    const y = pos.y - pos.height / 2;
    const headerBottom = y + parts.headerH;
    return {
      id: e.id,
      title: e.alias ?? e.name,
      rect: { x, y, w: pos.width, h: pos.height },
      headerBottom,
      columns: parts.cols.map((c) => x + c) as unknown as ErEntityBox["columns"],
      rows: e.attributes.map((a, i) => ({
        id: a.id,
        y: headerBottom + PAD_Y / 2 + (i + 0.5) * ROW_H,
        type: a.type,
        name: a.name,
        keys: a.keys.join(", "),
        comment: a.comment ?? "",
      })),
    };
  });

  const rectById = new Map<string, Rect>(boxes.map((b) => [b.id, b.rect]));
  const selfCount = new Map<string, number>();
  let selfMaxRight = 0;
  const taken = collisionIndex(boxes.map((b) => b.rect));

  const edges: ErEdge[] = ir.relationships.map((r) => {
    const label = r.label ?? "";
    let points: Point[];
    let labelPos: Point;
    if (r.from === r.to) {
      const rect = rectById.get(r.from)!;
      const k = selfCount.get(r.from) ?? 0;
      selfCount.set(r.from, k + 1);
      const right = rect.x + rect.w;
      const reach = right + SELF_W + k * SELF_STEP;
      const cy = rect.y + Math.min(rect.h / 2, SELF_H * (k + 1.5));
      points = [
        { x: right, y: cy - SELF_H / 2 },
        { x: reach, y: cy - SELF_H / 2 },
        { x: reach, y: cy + SELF_H / 2 },
        { x: right, y: cy + SELF_H / 2 },
      ];
      const spot = placeSelfLoopLabel(taken, rect, reach, cy, measure.measure(label, BODY_FONT));
      labelPos = spot.labelPos;
      selfMaxRight = Math.max(selfMaxRight, spot.right + 6);
    } else {
      const e = g.edge(r.from, r.to, r.id);
      points = e.points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y }));
      const mid = points[Math.floor(points.length / 2)]!;
      labelPos = { x: mid.x, y: mid.y - 6 };
    }
    return { id: r.id, points, fromCard: r.fromCard, toCard: r.toCard, identifying: r.identifying, label, labelPos };
  });

  const graph = g.graph();
  const baseW = graph.width !== undefined && Number.isFinite(graph.width) ? graph.width : 200;
  const h = graph.height !== undefined && Number.isFinite(graph.height) ? graph.height : 100;
  return { kind: "er", size: { w: Math.max(baseW, selfMaxRight), h }, boxes, edges };
}
