import dagre from "@dagrejs/dagre";
import type { ElementId, RelationId, RequirementIR, RequirementRelationType, RequirementId } from "@gmermaid/ir";
import type { TextMeasurer } from "./measurer";
import type { Point, Rect } from "./result";

const TITLE_FONT = { fontSize: 14, fontFamily: "sans-serif", bold: true } as const;
const BODY_FONT = { fontSize: 12, fontFamily: "sans-serif" } as const;
const PAD_X = 12;
const PAD_Y = 10;
const LINE_H = 18;
const MIN_W = 140;
// self-relation detour geometry (right side of the node), as in the class layout
const SELF_REL_W = 30;
const SELF_REL_H = 26;
const SELF_REL_STEP = 14;
/** Longest body line before it is wrapped onto the next line. */
const MAX_LINE_CHARS = 34;

export interface RequirementBox {
  readonly id: RequirementId | ElementId;
  readonly rect: Rect;
  /** `<<requirement>>` / `<<element>>` header line. */
  readonly stereotype: string;
  readonly name: string;
  /** Rendered body lines (`Id: 1.1`, `Risk: High`, …), already wrapped. */
  readonly lines: readonly string[];
  /** y of the line under the name/type header. */
  readonly headerBottom: number;
}

export interface RequirementEdge {
  readonly id: RelationId;
  readonly points: readonly Point[];
  readonly type: RequirementRelationType;
  readonly label: string;
  readonly labelPos: Point;
}

export interface RequirementLayout {
  readonly kind: "requirement";
  readonly size: { readonly w: number; readonly h: number };
  readonly boxes: readonly RequirementBox[];
  readonly edges: readonly RequirementEdge[];
}

/** Greedy word wrap — long requirement texts would otherwise stretch the graph. */
function wrap(text: string): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter((w) => w !== "")) {
      if (line === "") line = word;
      else if (line.length + 1 + word.length <= MAX_LINE_CHARS) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

export function layoutRequirementDiagram(ir: RequirementIR, measure: TextMeasurer): RequirementLayout {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: ir.direction ?? "TB", nodesep: 50, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));

  const nodes: { id: RequirementId | ElementId; stereotype: string; name: string; lines: string[] }[] = [
    ...ir.requirements.map((r) => ({
      id: r.id,
      stereotype: `«${r.type}»`,
      name: r.name,
      lines: [
        ...(r.reqId !== undefined ? [`Id: ${r.reqId}`] : []),
        ...(r.text !== undefined ? wrap(`Text: ${r.text}`) : []),
        ...(r.risk !== undefined ? [`Risk: ${r.risk}`] : []),
        ...(r.verifyMethod !== undefined ? [`Verify: ${r.verifyMethod}`] : []),
      ],
    })),
    ...ir.elements.map((e) => ({
      id: e.id,
      stereotype: "«element»",
      name: e.name,
      lines: [
        ...(e.type !== undefined ? [`Type: ${e.type}`] : []),
        ...(e.docRef !== undefined ? wrap(`Doc Ref: ${e.docRef}`) : []),
      ],
    })),
  ];

  const geom = new Map<string, { headerH: number; lines: string[] }>();
  for (const n of nodes) {
    const headerH = PAD_Y * 2 + LINE_H + measure.measure(n.name, TITLE_FONT).h;
    const bodyH = n.lines.length === 0 ? PAD_Y : PAD_Y * 2 + n.lines.length * LINE_H;
    const widths = [
      measure.measure(n.stereotype, BODY_FONT).w,
      measure.measure(n.name, TITLE_FONT).w,
      ...n.lines.map((s) => measure.measure(s, BODY_FONT).w),
    ];
    geom.set(n.id, { headerH, lines: n.lines });
    g.setNode(n.id, { width: Math.max(MIN_W, Math.max(...widths) + PAD_X * 2), height: headerH + bodyH });
  }

  for (const r of ir.relations) {
    if (!g.hasNode(r.from) || !g.hasNode(r.to)) {
      throw new Error(`layoutRequirementDiagram: relation ${r.id} references a missing node`);
    }
    // dagre cannot route self-edges — synthesized after layout as a detour
    if (r.from !== r.to) g.setEdge(r.from, r.to, {}, r.id);
  }

  dagre.layout(g);

  const boxes: RequirementBox[] = nodes.map((n) => {
    const pos = g.node(n.id);
    const parts = geom.get(n.id)!;
    const x = pos.x - pos.width / 2;
    const y = pos.y - pos.height / 2;
    return {
      id: n.id,
      stereotype: n.stereotype,
      name: n.name,
      lines: parts.lines,
      rect: { x, y, w: pos.width, h: pos.height },
      headerBottom: y + parts.headerH,
    };
  });

  const rectById = new Map<string, Rect>(boxes.map((b) => [b.id, b.rect]));
  const selfCount = new Map<string, number>();
  let selfMaxRight = 0;

  const edges: RequirementEdge[] = ir.relations.map((r) => {
    const label = `«${r.type}»`;
    let points: Point[];
    let labelPos: Point;
    if (r.from === r.to) {
      const rect = rectById.get(r.from)!;
      const k = selfCount.get(r.from) ?? 0;
      selfCount.set(r.from, k + 1);
      const right = rect.x + rect.w;
      const reach = right + SELF_REL_W + k * SELF_REL_STEP;
      const cy = rect.y + Math.min(rect.h / 2, SELF_REL_H * (k + 1.5));
      points = [
        { x: right, y: cy - SELF_REL_H / 2 },
        { x: reach, y: cy - SELF_REL_H / 2 },
        { x: reach, y: cy + SELF_REL_H / 2 },
        { x: right, y: cy + SELF_REL_H / 2 },
      ];
      labelPos = { x: reach + 6, y: cy };
      selfMaxRight = Math.max(selfMaxRight, reach + measure.measure(label, BODY_FONT).w + 12);
    } else {
      const e = g.edge(r.from, r.to, r.id);
      points = e.points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y }));
      const mid = points[Math.floor(points.length / 2)]!;
      labelPos = { x: mid.x, y: mid.y - 6 };
    }
    return { id: r.id, points, type: r.type, label, labelPos };
  });

  const graph = g.graph();
  // dagre reports -Infinity for an empty graph; self-edge detours also stick
  // out past its extent, so both widen the canvas (cf. the class layout).
  const baseW = graph.width !== undefined && Number.isFinite(graph.width) ? graph.width : 200;
  const h = graph.height !== undefined && Number.isFinite(graph.height) ? graph.height : 100;
  return { kind: "requirement", size: { w: Math.max(baseW, selfMaxRight), h }, boxes, edges };
}
