import dagre from "@dagrejs/dagre";
import {
  formatAttribute,
  formatMethod,
  type ClassIR,
  type ClassId,
  type RelationId,
  type RelationType,
} from "@gmermaid/ir";
import type { TextMeasurer } from "./measurer";
import type { Point, Rect } from "./result";

const NAME_FONT = { fontSize: 14, fontFamily: "sans-serif", bold: true } as const;
const MEMBER_FONT = { fontSize: 12, fontFamily: "monospace" } as const;
const PAD_X = 12;
const HEADER_PAD_Y = 8;
const MEMBER_LINE_H = 18;
const COMPARTMENT_PAD_Y = 5;
const MIN_W = 110;
// self-relation detour geometry (right side of the node)
const SELF_REL_W = 30;
const SELF_REL_H = 26;
const SELF_REL_STEP = 14;

export interface ClassBox {
  readonly id: ClassId;
  readonly rect: Rect;
  readonly name: string;
  readonly stereotype?: string;
  readonly attributes: readonly string[];
  readonly methods: readonly string[];
  /** y of the line under the name compartment. */
  readonly headerBottom: number;
  /** y of the line under the attributes compartment. */
  readonly attributesBottom: number;
}

export interface RelationPath {
  readonly id: RelationId;
  readonly points: readonly Point[];
  readonly type: RelationType;
  readonly label?: string;
  readonly labelPos?: Point;
  readonly fromCardinality?: string;
  readonly fromCardinalityPos?: Point;
  readonly toCardinality?: string;
  readonly toCardinalityPos?: Point;
}

export interface ClassLayout {
  readonly kind: "class";
  readonly size: { readonly w: number; readonly h: number };
  readonly classes: readonly ClassBox[];
  readonly relations: readonly RelationPath[];
}

export function layoutClassDiagram(ir: ClassIR, measure: TextMeasurer): ClassLayout {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: ir.direction ?? "TB", nodesep: 50, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));

  const rendered = new Map<
    ClassId,
    { attributes: string[]; methods: string[]; headerH: number; attrsH: number; methodsH: number }
  >();

  for (const c of ir.classes) {
    const attributes = c.attributes.map(formatAttribute);
    const methods = c.methods.map(formatMethod);
    const headerH =
      HEADER_PAD_Y * 2 +
      measure.measure(c.name, NAME_FONT).h +
      (c.stereotype !== undefined ? MEMBER_LINE_H : 0);
    const attrsH = COMPARTMENT_PAD_Y * 2 + attributes.length * MEMBER_LINE_H;
    const methodsH = COMPARTMENT_PAD_Y * 2 + methods.length * MEMBER_LINE_H;
    const widths = [
      measure.measure(c.name, NAME_FONT).w,
      c.stereotype !== undefined ? measure.measure(`«${c.stereotype}»`, MEMBER_FONT).w : 0,
      ...attributes.map((s) => measure.measure(s, MEMBER_FONT).w),
      ...methods.map((s) => measure.measure(s, MEMBER_FONT).w),
    ];
    const w = Math.max(MIN_W, Math.max(...widths) + PAD_X * 2);
    rendered.set(c.id, { attributes, methods, headerH, attrsH, methodsH });
    g.setNode(c.id, { width: w, height: headerH + attrsH + methodsH });
  }

  for (const r of ir.relations) {
    if (!g.hasNode(r.from) || !g.hasNode(r.to)) {
      throw new Error(`layoutClassDiagram: relation ${r.id} references a missing class`);
    }
    // dagre cannot route self-edges — they are synthesized after layout as a
    // rectangular detour off the node's right side (cf. SELF_MSG_EXTRA in
    // the sequence layout)
    if (r.from !== r.to) g.setEdge(r.from, r.to, {}, r.id);
  }

  dagre.layout(g);

  const classes: ClassBox[] = ir.classes.map((c) => {
    const pos = g.node(c.id);
    const parts = rendered.get(c.id)!;
    const x = pos.x - pos.width / 2;
    const y = pos.y - pos.height / 2;
    return {
      id: c.id,
      name: c.name,
      ...(c.stereotype !== undefined ? { stereotype: c.stereotype } : {}),
      attributes: parts.attributes,
      methods: parts.methods,
      rect: { x, y, w: pos.width, h: pos.height },
      headerBottom: y + parts.headerH,
      attributesBottom: y + parts.headerH + parts.attrsH,
    };
  });

  const boxByClass = new Map<ClassId, Rect>(classes.map((c) => [c.id, c.rect]));
  // stacked self-relations on one node fan outward by index
  const selfCount = new Map<ClassId, number>();
  let selfMaxRight = 0;

  const relations: RelationPath[] = ir.relations.map((r) => {
    let points: Point[];
    let labelPos: Point;
    if (r.from === r.to) {
      const rect = boxByClass.get(r.from)!;
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
      const labelW = r.label !== undefined ? measure.measure(r.label, MEMBER_FONT).w + 12 : 0;
      selfMaxRight = Math.max(selfMaxRight, reach + labelW);
    } else {
      const e = g.edge(r.from, r.to, r.id);
      points = e.points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y }));
      const mid = points[Math.floor(points.length / 2)]!;
      labelPos = { x: mid.x, y: mid.y - 6 };
    }
    const first = points[0]!;
    const last = points[points.length - 1]!;
    return {
      id: r.id,
      points,
      type: r.type,
      ...(r.label !== undefined ? { label: r.label, labelPos } : {}),
      ...(r.fromCardinality !== undefined
        ? { fromCardinality: r.fromCardinality, fromCardinalityPos: { x: first.x + 8, y: first.y + 14 } }
        : {}),
      ...(r.toCardinality !== undefined
        ? { toCardinality: r.toCardinality, toCardinalityPos: { x: last.x + 8, y: last.y - 8 } }
        : {}),
    };
  });

  const graph = g.graph();
  // dagre reports -Infinity for an empty graph — clamp to a sane empty canvas.
  // Self-relation detours (and their labels) stick out past dagre's extent,
  // so they widen the canvas too (same class of oversight as the -Infinity).
  const baseW = graph.width !== undefined && Number.isFinite(graph.width) ? graph.width : 200;
  const w = Math.max(baseW, selfMaxRight);
  const hgt = graph.height !== undefined && Number.isFinite(graph.height) ? graph.height : 100;
  return {
    kind: "class",
    size: { w, h: hgt },
    classes,
    relations,
  };
}
