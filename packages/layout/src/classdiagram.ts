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
import { collisionIndex, pathHitsRect } from "./collision";
import { bboxOf, borderCrossing, placeNote, placeSelfLoopLabel } from "./compound";
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

/** A routed relation in the coordinates of the container that produced it. */
interface Route {
  readonly points: Point[];
  /** the stretch dagre laid out, before the leg into a frame is added */
  readonly routed: Point[];
}

interface SubLayout {
  readonly w: number;
  readonly h: number;
  readonly rects: Map<string, Rect>;
  readonly paths: Map<string, Point[]>;
  /** by `${id}|${end}` — the piece of a crossing edge routed in here */
  readonly legs: Map<string, Point[]>;
}

/**
 * The stretch of an edge inside the namespace it crosses. dagre only sees one
 * container at a time, so an edge reaching into a frame is handed to that
 * frame's own graph too, attached to a near-zero PROXY standing in for
 * whatever is outside — otherwise the line would cut straight through the
 * classes between the border and its endpoint.
 */
interface Leg {
  readonly id: string;
  readonly end: "from" | "to";
  readonly target: string;
}

/** The proxy that stands in for the far side of a crossing edge. Not zero:
 * dagre refuses to intersect a rectangle with no area. */
const PROXY_SIZE = { width: 1, height: 1 } as const;

const proxyId = (id: string, end: "from" | "to"): string => `\u0000${id}|${end}`;

export function layoutClassDiagram(ir: ClassIR, measure: TextMeasurer): ClassLayout {
  const usedNamespaces = ir.namespaces.filter((ns) => ir.classes.some((c) => c.namespace === ns.id));
  const used = new Set(usedNamespaces.map((ns) => ns.id));
  /** The frame a class sits in, if that namespace is drawn at all. */
  const nsOf = new Map<string, NamespaceId | undefined>(
    ir.classes.map((c) => [c.id as string, c.namespace !== undefined && used.has(c.namespace) ? c.namespace : undefined]),
  );

  const rendered = new Map<
    ClassId,
    { title: string; attributes: MemberLine[]; methods: MemberLine[]; headerH: number; attrsH: number; methodsH: number }
  >();
  const boxSize = new Map<string, { width: number; height: number }>();

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
    boxSize.set(c.id, { width: w, height: headerH + attrsH + methodsH });
  }

  // notes take part in the layout as ordinary nodes: an attached note is
  // pulled next to its target by an (invisible) edge, a free note floats as
  // its own component. A note never sits inside a namespace frame.
  const noteSize = new Map<NoteId, { w: number; h: number }>();
  for (const n of ir.notes) {
    const m = measure.measure(n.text, NOTE_FONT);
    const w = m.w + NOTE_PAD * 2;
    const h = Math.max(26, m.h + NOTE_PAD * 2);
    noteSize.set(n.id, { w, h });
    boxSize.set(n.id, { width: w, height: h });
  }

  for (const r of ir.relations) {
    for (const end of [r.from, r.to] as const) {
      if (!rendered.has(end)) throw new Error(`layoutClassDiagram: relation ${r.id} references a missing class`);
    }
  }

  // Which graph an edge is routed in: the namespace that holds both ends, or
  // the diagram. One that crosses a frame is routed to the frame — a namespace
  // is a plain node in the outer graph, never a dagre cluster, because dagre's
  // compound layout adds border ranks that stretch every rank gap in the
  // diagram (measured: 60px between two classes became 180px with one frame).
  const ROOT = "";
  interface Placed {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly label?: string;
  }
  const edgesIn = new Map<string, Placed[]>();
  const legsIn = new Map<NamespaceId, Leg[]>();
  const place = (id: string, from: string, to: string, label?: string) => {
    const nf = nsOf.get(from);
    const nt = nsOf.get(to);
    const container = nf === nt ? nf : undefined;
    const lift = (x: string) => (container === undefined ? (nsOf.get(x) ?? x) : x);
    const key = container ?? ROOT;
    edgesIn.set(key, [
      ...(edgesIn.get(key) ?? []),
      { id, from: lift(from), to: lift(to), ...(label !== undefined ? { label } : {}) },
    ]);
    if (container !== undefined) return;
    for (const [end, node] of [
      ["from", from],
      ["to", to],
    ] as const) {
      const frame = nsOf.get(node);
      if (frame === undefined) continue;
      legsIn.set(frame, [...(legsIn.get(frame) ?? []), { id, end, target: node }]);
    }
  };
  for (const r of ir.relations) {
    // dagre cannot route self-edges — they are synthesized after layout as a
    // rectangular detour off the node's right side (cf. SELF_MSG_EXTRA in
    // the sequence layout)
    if (r.from !== r.to) place(r.id, r.from, r.to, r.label);
  }
  for (const n of ir.notes) if (n.target !== undefined && rendered.has(n.target)) place(n.id, n.id, n.target);

  /** Everything directly inside `namespace` (undefined = the diagram) in a
   * dagre graph of its own. A namespace enters the diagram's graph as a single
   * node the size of its finished contents. */
  const layoutContainer = (namespace: NamespaceId | undefined, frames: Map<NamespaceId, SubLayout>): SubLayout => {
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setGraph({ rankdir: ir.direction ?? "TB", nodesep: 50, ranksep: 60 });
    g.setDefaultEdgeLabel(() => ({}));

    for (const c of ir.classes) if (nsOf.get(c.id) === namespace) g.setNode(c.id, boxSize.get(c.id)!);
    if (namespace === undefined) {
      for (const ns of usedNamespaces) {
        const sub = frames.get(ns.id)!;
        g.setNode(ns.id, { width: sub.w, height: sub.h });
      }
      for (const n of ir.notes) g.setNode(n.id, boxSize.get(n.id)!);
    }

    const edges = edgesIn.get(namespace ?? ROOT) ?? [];
    for (const e of edges) g.setEdge(e.from, e.to, edgeLabelSize(e.label, measure, NOTE_FONT), e.id);

    // an edge crossing this frame is routed inside it too, from a proxy that
    // stands for everything outside
    const legs = namespace !== undefined ? (legsIn.get(namespace) ?? []) : [];
    for (const leg of legs) {
      const proxy = proxyId(leg.id, leg.end);
      g.setNode(proxy, PROXY_SIZE);
      if (leg.end === "to") g.setEdge(proxy, leg.target, {}, `${leg.id}|leg`);
      else g.setEdge(leg.target, proxy, {}, `${leg.id}|leg`);
    }

    dagre.layout(g);

    const proxies = new Set(legs.map((leg) => proxyId(leg.id, leg.end)));
    const local = new Map<string, Rect>();
    for (const id of g.nodes()) {
      if (proxies.has(id)) continue;
      const pos = g.node(id);
      local.set(id, { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2, w: pos.width, h: pos.height });
    }
    const routes = new Map<string, Point[]>();
    for (const e of edges) {
      routes.set(e.id, g.edge(e.from, e.to, e.id).points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y })));
    }
    const legRoutes = new Map<string, Point[]>();
    for (const leg of legs) {
      const proxy = proxyId(leg.id, leg.end);
      const e = leg.end === "to" ? g.edge(proxy, leg.target, `${leg.id}|leg`) : g.edge(leg.target, proxy, `${leg.id}|leg`);
      legRoutes.set(`${leg.id}|${leg.end}`, e.points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y })));
    }

    // the frame wraps its members, with the title band left clear above them
    const framed = namespace !== undefined;
    const inner = bboxOf([
      ...local.values(),
      ...[...routes.values()].flat().map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })),
      ...[...legRoutes.values()].flat().map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })),
    ]);
    const offX = framed ? NS_PAD - inner.x : 0;
    const offY = framed ? NS_TITLE_H - inner.y : 0;
    const rects = new Map<string, Rect>();
    for (const [id, r] of local) rects.set(id, { ...r, x: r.x + offX, y: r.y + offY });
    const paths = new Map<string, Point[]>();
    for (const [id, pts] of routes) paths.set(id, pts.map((q) => ({ x: q.x + offX, y: q.y + offY })));
    const legPaths = new Map<string, Point[]>();
    for (const [key, pts] of legRoutes) legPaths.set(key, pts.map((q) => ({ x: q.x + offX, y: q.y + offY })));

    const graph = g.graph();
    // dagre reports -Infinity for an empty graph — clamp to a sane empty canvas
    return {
      w: framed ? inner.w + NS_PAD * 2 : Number.isFinite(graph.width) ? graph.width! : 200,
      h: framed ? inner.h + NS_TITLE_H + NS_PAD : Number.isFinite(graph.height) ? graph.height! : 100,
      rects,
      paths,
      legs: legPaths,
    };
  };

  const frames = new Map<NamespaceId, SubLayout>();
  for (const ns of usedNamespaces) frames.set(ns.id, layoutContainer(ns.id, frames));
  const root = layoutContainer(undefined, frames);

  const rectOf = (id: string): Rect => {
    const own = root.rects.get(id);
    if (own !== undefined) return own;
    const frame = root.rects.get(nsOf.get(id)!)!;
    const inside = frames.get(nsOf.get(id)!)!.rects.get(id)!;
    return { ...inside, x: inside.x + frame.x, y: inside.y + frame.y };
  };
  /** The drawn polyline: dagre's route, with the leg into a frame added. */
  const pathOf = (id: string, from: string, to: string): Route => {
    const own = root.paths.get(id);
    if (own === undefined) {
      const frame = root.rects.get(nsOf.get(from)!)!;
      const inside = frames
        .get(nsOf.get(from)!)!
        .paths.get(id)!
        .map((p) => ({ x: p.x + frame.x, y: p.y + frame.y }));
      return { points: inside, routed: inside };
    }
    // dagre stopped the line at the frame: stitch on the stretch the frame
    // routed for it, entering at the border point that aims at it
    let points = own;
    const legOf = (end: "from" | "to", node: string): Point[] | undefined => {
      const frame = nsOf.get(node);
      if (frame === undefined) return undefined;
      const box = root.rects.get(frame)!;
      return frames.get(frame)!.legs.get(`${id}|${end}`)!.map((p) => ({ x: p.x + box.x, y: p.y + box.y }));
    };
    const into = legOf("to", to);
    if (into !== undefined) {
      const hit = borderCrossing(points.at(-2) ?? points.at(-1)!, into[0]!, rectOf(nsOf.get(to)!));
      points = [...points.slice(0, -1), hit ?? points.at(-1)!, ...into];
    }
    const outOf = legOf("from", from);
    if (outOf !== undefined) {
      const hit = borderCrossing(points[1] ?? points[0]!, outOf.at(-1)!, rectOf(nsOf.get(from)!));
      points = [...outOf, hit ?? points[0]!, ...points.slice(1)];
    }
    return { points, routed: own };
  };

  const classes: ClassBox[] = ir.classes.map((c) => {
    const pos = rectOf(c.id);
    const parts = rendered.get(c.id)!;
    const x = pos.x;
    const y = pos.y;
    return {
      id: c.id,
      name: parts.title,
      stereotypes: c.stereotypes,
      attributes: parts.attributes,
      methods: parts.methods,
      rect: { x, y, w: pos.w, h: pos.h },
      headerBottom: y + parts.headerH,
      attributesBottom: y + parts.headerH + parts.attrsH,
    };
  });

  const namespaces: NamespaceFrame[] = usedNamespaces.map((ns) => ({ id: ns.id, name: ns.name, rect: rectOf(ns.id) }));

  const boxByClass = new Map<ClassId, Rect>(classes.map((c) => [c.id, c.rect]));

  // Dagre placed the notes as ordinary nodes, so a note never overlaps a box.
  // It routed the relations afterwards, though, through whatever gap was left
  // — and a route can run straight across a note. Only those get moved: a note
  // dagre put somewhere good stays exactly where it is, routed link and all.
  const routes = new Map<string, readonly Point[]>();
  for (const r of ir.relations) if (r.from !== r.to) routes.set(r.id, pathOf(r.id, r.from, r.to).points);
  const onARoute = (rect: Rect): boolean => [...routes.values()].some((p) => pathHitsRect(p, rect));

  const dagrePlaced = ir.notes.map((n) => ({ note: n, rect: rectOf(n.id), stuck: onARoute(rectOf(n.id)) }));
  const taken = collisionIndex([
    ...classes.map((c) => c.rect),
    // a note never sits inside a namespace frame
    ...namespaces.map((ns) => ns.rect),
    ...dagrePlaced.filter((p) => !p.stuck).map((p) => p.rect),
  ]);
  for (const p of routes.values()) taken.addPath(p);

  const notes: ClassNoteBox[] = dagrePlaced.map(({ note: n, rect, stuck }) => {
    const target = n.target !== undefined && rendered.has(n.target) ? boxByClass.get(n.target) : undefined;
    if (!stuck || target === undefined) {
      // a free note has nothing to point at, so moving it says nothing: leave it
      if (stuck) taken.add(rect);
      const link = target !== undefined ? pathOf(n.id, n.id, n.target!).points : undefined;
      return { id: n.id, rect, text: n.text, ...(link !== undefined ? { link } : {}) };
    }
    const spot = placeNote(taken, target, { w: rect.w, h: rect.h }, "right");
    return {
      id: n.id,
      rect: spot.rect,
      text: n.text,
      link: [
        { x: spot.anchor.x1, y: spot.anchor.y1 },
        { x: spot.anchor.x2, y: spot.anchor.y2 },
      ],
    };
  });

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
      if (r.label !== undefined) {
        const spot = placeSelfLoopLabel(taken, rect, reach, cy, measure.measure(r.label, MEMBER_FONT));
        labelPos = spot.labelPos;
        selfMaxRight = Math.max(selfMaxRight, spot.right + 6);
      } else {
        labelPos = { x: reach + 6, y: cy };
        selfMaxRight = Math.max(selfMaxRight, reach);
      }
    } else {
      const route = pathOf(r.id, r.from, r.to);
      points = [...route.points];
      // the label belongs in the gap dagre kept for it, never on the leg that
      // dives into a frame
      const mid = route.routed[Math.floor(route.routed.length / 2)]!;
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

  // Self-relation detours (and their labels) stick out past dagre's extent,
  // so they widen the canvas too.
  let w = Math.max(root.w, selfMaxRight);
  let h = root.h;
  for (const rect of [...namespaces.map((ns) => ns.rect), ...classes.map((c) => c.rect), ...notes.map((n) => n.rect)]) {
    w = Math.max(w, rect.x + rect.w);
    h = Math.max(h, rect.y + rect.h);
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
