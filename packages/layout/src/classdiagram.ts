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
  g.setGraph({ rankdir: "TB", nodesep: 50, ranksep: 60 });
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
    g.setEdge(r.from, r.to, {}, r.id);
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

  const relations: RelationPath[] = ir.relations.map((r) => {
    const e = g.edge(r.from, r.to, r.id);
    const points: Point[] = e.points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y }));
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const mid = points[Math.floor(points.length / 2)]!;
    return {
      id: r.id,
      points,
      type: r.type,
      ...(r.label !== undefined ? { label: r.label, labelPos: { x: mid.x, y: mid.y - 6 } } : {}),
      ...(r.fromCardinality !== undefined
        ? { fromCardinality: r.fromCardinality, fromCardinalityPos: { x: first.x + 8, y: first.y + 14 } }
        : {}),
      ...(r.toCardinality !== undefined
        ? { toCardinality: r.toCardinality, toCardinalityPos: { x: last.x + 8, y: last.y - 8 } }
        : {}),
    };
  });

  const graph = g.graph();
  // dagre reports -Infinity for an empty graph — clamp to a sane empty canvas
  const w = graph.width !== undefined && Number.isFinite(graph.width) ? graph.width : 200;
  const hgt = graph.height !== undefined && Number.isFinite(graph.height) ? graph.height : 100;
  return {
    kind: "class",
    size: { w, h: hgt },
    classes,
    relations,
  };
}
