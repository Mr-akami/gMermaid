import dagre from "@dagrejs/dagre";
import {
  displayAttribute,
  displayMethod,
  genericToAngle,
  type ClassIR,
  type ClassId,
  type NamespaceId,
  type NoteId,
  type RelationHead,
  type RelationLine,
  type RelationId,
} from "@gmermaid/ir";
import { edgeLabelSize } from "./measurer";
import type { TextMeasurer } from "./measurer";
import type { Point, Rect } from "./result";

const NAME_FONT = { fontSize: 14, fontFamily: "sans-serif", bold: true } as const;
const MEMBER_FONT = { fontSize: 12, fontFamily: "monospace" } as const;
const NOTE_FONT = { fontSize: 12, fontFamily: "sans-serif" } as const;
const PAD_X = 12;
const HEADER_PAD_Y = 8;
const MEMBER_LINE_H = 18;
const COMPARTMENT_PAD_Y = 5;
const MIN_W = 110;
const NOTE_PAD = 8;
// visual breathing room around a namespace frame; the extra top holds the title
const NS_PAD = 10;
/** Height of a namespace's title band. */
export const NAMESPACE_TITLE_BAND = 24;
const NS_TITLE_H = NAMESPACE_TITLE_BAND + NS_PAD;
// self-relation detour geometry (right side of the node)
const SELF_REL_W = 30;
const SELF_REL_H = 26;
const SELF_REL_STEP = 14;

/** One rendered member line: classifiers survive as styling, not as text. */
export interface MemberLine {
  readonly text: string;
  /** mermaid `$` — underlined. */
  readonly static: boolean;
  /** mermaid `*` — italic. */
  readonly abstract: boolean;
}

export interface ClassBox {
  readonly id: ClassId;
  readonly rect: Rect;
  /** Display text: the `["label"]` when present, else the (generic) name. */
  readonly name: string;
  readonly stereotypes: readonly string[];
  readonly attributes: readonly MemberLine[];
  readonly methods: readonly MemberLine[];
  /** y of the line under the name compartment. */
  readonly headerBottom: number;
  /** y of the line under the attributes compartment. */
  readonly attributesBottom: number;
}

export interface NamespaceFrame {
  readonly id: NamespaceId;
  readonly name: string;
  readonly rect: Rect;
}

export interface ClassNoteBox {
  readonly id: NoteId;
  readonly rect: Rect;
  readonly text: string;
  /** dashed connector to the target class; absent for a free note. */
  readonly link?: readonly Point[];
}

export interface RelationPath {
  readonly id: RelationId;
  readonly points: readonly Point[];
  readonly line: RelationLine;
  readonly headFrom: RelationHead;
  readonly headTo: RelationHead;
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
  readonly notes: readonly ClassNoteBox[];
  readonly namespaces: readonly NamespaceFrame[];
}

export function layoutClassDiagram(ir: ClassIR, measure: TextMeasurer): ClassLayout {
  // compound: namespaces are dagre clusters (cf. composite states)
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: true });
  g.setGraph({ rankdir: ir.direction ?? "TB", nodesep: 50, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));

  const usedNamespaces = ir.namespaces.filter((ns) => ir.classes.some((c) => c.namespace === ns.id));
  for (const ns of usedNamespaces) g.setNode(ns.id, {});

  const rendered = new Map<
    ClassId,
    { title: string; attributes: MemberLine[]; methods: MemberLine[]; headerH: number; attrsH: number; methodsH: number }
  >();

  for (const c of ir.classes) {
    const title = c.label ?? `${c.name}${c.generic !== undefined ? genericToAngle(`~${c.generic}~`) : ""}`;
    const attributes = c.attributes.map((a) => ({ text: displayAttribute(a), static: a.static ?? false, abstract: false }));
    const methods = c.methods.map((m) => ({ text: displayMethod(m), static: m.static ?? false, abstract: m.abstract ?? false }));
    const headerH = HEADER_PAD_Y * 2 + measure.measure(title, NAME_FONT).h + c.stereotypes.length * MEMBER_LINE_H;
    const attrsH = COMPARTMENT_PAD_Y * 2 + attributes.length * MEMBER_LINE_H;
    const methodsH = COMPARTMENT_PAD_Y * 2 + methods.length * MEMBER_LINE_H;
    const widths = [
      measure.measure(title, NAME_FONT).w,
      ...c.stereotypes.map((s) => measure.measure(`«${s}»`, MEMBER_FONT).w),
      ...attributes.map((s) => measure.measure(s.text, MEMBER_FONT).w),
      ...methods.map((s) => measure.measure(s.text, MEMBER_FONT).w),
    ];
    const w = Math.max(MIN_W, Math.max(...widths) + PAD_X * 2);
    rendered.set(c.id, { title, attributes, methods, headerH, attrsH, methodsH });
    g.setNode(c.id, { width: w, height: headerH + attrsH + methodsH });
    if (c.namespace !== undefined && g.hasNode(c.namespace)) g.setParent(c.id, c.namespace);
  }

  for (const r of ir.relations) {
    if (!g.hasNode(r.from) || !g.hasNode(r.to)) {
      throw new Error(`layoutClassDiagram: relation ${r.id} references a missing class`);
    }
    // dagre cannot route self-edges — they are synthesized after layout as a
    // rectangular detour off the node's right side (cf. SELF_MSG_EXTRA in
    // the sequence layout)
    if (r.from !== r.to) g.setEdge(r.from, r.to, edgeLabelSize(r.label, measure, NOTE_FONT), r.id);
  }

  // notes take part in the layout as ordinary nodes: an attached note is
  // pulled next to its target by an (invisible) edge, a free note floats as
  // its own component
  const noteSize = new Map<NoteId, { w: number; h: number }>();
  for (const n of ir.notes) {
    const m = measure.measure(n.text, NOTE_FONT);
    const w = m.w + NOTE_PAD * 2;
    const h = Math.max(26, m.h + NOTE_PAD * 2);
    noteSize.set(n.id, { w, h });
    g.setNode(n.id, { width: w, height: h });
    if (n.target !== undefined && g.hasNode(n.target)) g.setEdge(n.id, n.target, {}, n.id);
  }

  dagre.layout(g);

  const classes: ClassBox[] = ir.classes.map((c) => {
    const pos = g.node(c.id);
    const parts = rendered.get(c.id)!;
    const x = pos.x - pos.width / 2;
    const y = pos.y - pos.height / 2;
    return {
      id: c.id,
      name: parts.title,
      stereotypes: c.stereotypes,
      attributes: parts.attributes,
      methods: parts.methods,
      rect: { x, y, w: pos.width, h: pos.height },
      headerBottom: y + parts.headerH,
      attributesBottom: y + parts.headerH + parts.attrsH,
    };
  });

  const namespaces: NamespaceFrame[] = usedNamespaces.map((ns) => {
    const pos = g.node(ns.id);
    // cluster rects come back tight around members — expand for border + title
    return {
      id: ns.id,
      name: ns.name,
      rect: {
        x: pos.x - pos.width / 2 - NS_PAD,
        y: pos.y - pos.height / 2 - NS_TITLE_H,
        w: pos.width + NS_PAD * 2,
        h: pos.height + NS_TITLE_H + NS_PAD,
      },
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
      line: r.line,
      headFrom: r.headFrom,
      headTo: r.headTo,
      ...(r.label !== undefined ? { label: r.label, labelPos } : {}),
      ...(r.fromCardinality !== undefined
        ? { fromCardinality: r.fromCardinality, fromCardinalityPos: { x: first.x + 8, y: first.y + 14 } }
        : {}),
      ...(r.toCardinality !== undefined
        ? { toCardinality: r.toCardinality, toCardinalityPos: { x: last.x + 8, y: last.y - 8 } }
        : {}),
    };
  });

  const notes: ClassNoteBox[] = ir.notes.map((n) => {
    const pos = g.node(n.id);
    const size = noteSize.get(n.id)!;
    const rect = { x: pos.x - size.w / 2, y: pos.y - size.h / 2, w: size.w, h: size.h };
    const link =
      n.target !== undefined && g.hasEdge(n.id, n.target, n.id)
        ? g.edge(n.id, n.target, n.id).points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y }))
        : undefined;
    return { id: n.id, rect, text: n.text, ...(link !== undefined ? { link } : {}) };
  });

  const graph = g.graph();
  // dagre reports -Infinity for an empty graph — clamp to a sane empty canvas.
  // Self-relation detours (and their labels) stick out past dagre's extent,
  // so they widen the canvas too (same class of oversight as the -Infinity).
  const baseW = graph.width !== undefined && Number.isFinite(graph.width) ? graph.width : 200;
  let w = Math.max(baseW, selfMaxRight);
  let h = graph.height !== undefined && Number.isFinite(graph.height) ? graph.height : 100;
  for (const ns of namespaces) {
    w = Math.max(w, ns.rect.x + ns.rect.w);
    h = Math.max(h, ns.rect.y + ns.rect.h);
  }
  return {
    kind: "class",
    size: { w, h },
    classes,
    relations,
    notes,
    namespaces,
  };
}
