import {
  normalizeUsecaseRelation,
  type ActorId,
  type ActorVariant,
  type BoundaryId,
  type BoundaryType,
  type NoteId,
  type UseCase,
  type UseCaseShape,
  type UsecaseActor,
  type UsecaseBoundary,
  type UsecaseHead,
  type UsecaseIR,
  type UsecaseNodeId,
  type UsecaseNote,
  type UsecaseRelation,
  type UsecaseRelationId,
} from "@gmermaid/ir";
import { prepareLines, unescapeLabel, unquote, type ParseError, type ParseResult } from "./common";

// Dialect the IR cannot hold is DISCARDED by design, the same as `%%`
// comments: frontmatter and `%%{init}%%`, `classDef` / `class` / `style` and
// `:::class` suffixes, `accTitle` / `accDescr`, explicit edge ids, edge
// `animation` / `animate` metadata, extra-dash edge length, actor `icon`
// metadata, and `json` tables (whose whole block is skipped).
const DROPPED = ["classDef", "class", "style", "cssClass", "click", "accTitle", "accDescr", "linkStyle"];

const N = "[A-Za-z0-9_]+";
/** mermaid's rule for a quoted declaration's identifier. */
const derivedName = (text: string): string => text.replaceAll(/\W/gu, "_");

const TO_HEAD: Record<string, UsecaseHead> = { ">": "arrow", o: "circle", x: "cross", "|>": "inheritance" };
const FROM_HEAD: Record<string, UsecaseHead> = { "<": "arrow", o: "circle", x: "cross" };

const LEFT_OP = "(<-{2,}|o-{2,}|x-{2,}|-{2,})";
const RIGHT_OP = "(-{2,}>|-{2,}o|-{2,}x|-{2,})";
const PLAIN_OP = "(-{2,}\\|>|<-{2,}|o-{2,}|x-{2,}|-{2,}>|-{2,}o|-{2,}x|-{2,})";

/** Marker kinds carried by one operator token (`--o`, `o--`, `-->`, …). */
function headsOf(op: string): { headFrom: UsecaseHead; headTo: UsecaseHead } {
  if (op.startsWith("<")) return { headFrom: "arrow", headTo: "none" };
  if (op.startsWith("o")) return { headFrom: "circle", headTo: "none" };
  if (op.startsWith("x")) return { headFrom: "cross", headTo: "none" };
  const tail = op.replace(/^-+/, "");
  return { headFrom: "none", headTo: tail === "" ? "none" : (TO_HEAD[tail] ?? "none") };
}

interface NodeRec {
  name: string;
  isActor: boolean;
  label?: string;
  shape: UseCaseShape;
  variant: ActorVariant;
  business?: true;
  stereotype?: string;
  boundary?: BoundaryId;
}

interface Metadata {
  readonly type?: string;
  readonly business?: boolean;
  /** True when a key only elements carry was seen (`type`, `business`,
   * `icon`) — it tells an element declaration from edge metadata. */
  readonly element: boolean;
}

/** `@{ type: hollow, business: true }` — unknown keys (`icon`, `animation`,
 * `animate`) are tolerated and dropped. */
function parseMetadata(raw: string): Metadata {
  const out: { type?: string; business?: boolean; element: boolean } = { element: false };
  for (const part of raw.split(",")) {
    const m = part.match(/^\s*([A-Za-z]+)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = unquote(m[2]!);
    if (key === "type") out.type = value;
    else if (key === "business") out.business = value === "true";
    if (key === "type" || key === "business" || key === "icon") out.element = true;
  }
  return out;
}

const readLabel = (raw: string): string => unescapeLabel(unquote(raw.trim()));

export function parseUsecase(code: string): ParseResult<UsecaseIR> {
  const errors: ParseError[] = [];
  const lines = prepareLines(code, { drop: DROPPED, stripClassSuffix: true });

  const nodes = new Map<string, NodeRec>();
  const order: string[] = [];
  const boundaries: UsecaseBoundary[] = [];
  const relations: UsecaseRelation[] = [];
  const notes: UsecaseNote[] = [];
  let relSeq = 0;
  let noteSeq = 0;
  let headerSeen = false;
  let direction: UsecaseIR["direction"];
  let openBoundary: { id: BoundaryId; name: string; line: number } | null = null;
  // `json X@{ … }` spans lines; the whole block is skipped (unsupported)
  let jsonDepth = 0;

  /** Every reference materialises a node: an undeclared endpoint is an
   * ellipse use case (mermaid's rule — actors are never inferred). */
  const touch = (name: string): NodeRec => {
    const existing = nodes.get(name);
    if (existing) return existing;
    const rec: NodeRec = { name, isActor: false, shape: "ellipse", variant: "default" };
    nodes.set(name, rec);
    order.push(name);
    return rec;
  };

  for (const { text: line, line: lineNo } of lines) {
    if (!headerSeen) {
      // `usecase` alone is not mermaid's spelling, but it is the obvious
      // typo and the kind is unambiguous, so it is accepted on import
      if (line !== "usecase-beta" && line !== "usecase") {
        errors.push({ line: lineNo, message: "expected `usecase-beta` header" });
        return { ok: false, errors };
      }
      headerSeen = true;
      continue;
    }

    if (jsonDepth > 0) {
      jsonDepth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
      continue;
    }

    if (/^json\s/.test(line)) {
      jsonDepth = (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
      continue;
    }

    if (openBoundary !== null) {
      if (line === "end") {
        openBoundary = null;
        continue;
      }
      if (!declaration(line, openBoundary.id)) {
        errors.push({ line: lineNo, message: `system boundaries hold only declarations: ${line}` });
      }
      continue;
    }

    const dir = line.match(/^direction\s+(TB|TD|BT|LR|RL)$/);
    if (dir) {
      direction = (dir[1] === "TD" ? "TB" : dir[1]) as NonNullable<UsecaseIR["direction"]>;
      continue;
    }

    const boundary = line.match(
      new RegExp(`^systemBoundary(?:\\s+(?:"([^"]*)"|(${N})(?:\\[([^\\]]*)\\]|\\(([^)]*)\\))?))?\\s*(?:@\\{([^}]*)\\})?$`),
    );
    if (boundary) {
      const quoted = boundary[1];
      const name = quoted !== undefined ? derivedName(readLabel(quoted)) : (boundary[2] ?? `boundary${boundaries.length + 1}`);
      const rawTitle = quoted ?? boundary[3] ?? boundary[4];
      const label = rawTitle !== undefined ? readLabel(rawTitle) : undefined;
      const type = parseMetadata(boundary[5] ?? "").type === "package" ? "package" : "default";
      const id = name as BoundaryId;
      if (!boundaries.some((b) => b.id === id)) {
        boundaries.push({
          id,
          name,
          // a title identical to the identifier adds nothing to display
          ...(label !== undefined && label !== name ? { label } : {}),
          type: type as BoundaryType,
        });
      }
      openBoundary = { id, name, line: lineNo };
      continue;
    }

    if (line === "end") {
      errors.push({ line: lineNo, message: "`end` without an open systemBoundary" });
      continue;
    }

    const note = line.match(new RegExp(`^note\\s+for\\s+(${N})\\s+(.+)$`));
    if (note) {
      touch(note[1]!);
      noteSeq += 1;
      notes.push({ id: `note-${noteSeq}` as NoteId, target: note[1]! as UsecaseNodeId, text: readLabel(note[2]!) });
      continue;
    }

    // an explicit edge id (`A opens@-- … --> B`) is dropped before matching
    const rel = line.replace(new RegExp(`\\s(${N})@(?=[-<ox.])`), " ");

    const uml = rel.match(new RegExp(`^(${N})\\s*\\.\\.>\\s*:\\s*(include|extend)\\s+(${N})$`));
    if (uml) {
      touch(uml[1]!);
      touch(uml[3]!);
      relSeq += 1;
      relations.push(
        normalizeUsecaseRelation({
          id: `relation-${relSeq}` as UsecaseRelationId,
          from: uml[1]! as UsecaseNodeId,
          to: uml[3]! as UsecaseNodeId,
          line: "dashed",
          headFrom: "none",
          headTo: "none",
          kind: uml[2] as "include" | "extend",
        }),
      );
      continue;
    }

    const labelled = rel.match(
      new RegExp(`^(${N})\\s+${LEFT_OP}\\s+(?:"([^"]*)"|(.+?))\\s+${RIGHT_OP}\\s+(${N})$`),
    );
    if (labelled) {
      const left = labelled[2]!;
      const right = labelled[5]!;
      const headFrom = left.startsWith("-") ? "none" : (FROM_HEAD[left[0]!] ?? "none");
      const rightTail = right.replace(/^-+/, "");
      const headTo = rightTail === "" ? "none" : (TO_HEAD[rightTail] ?? "none");
      const text = labelled[3] ?? labelled[4] ?? "";
      touch(labelled[1]!);
      touch(labelled[6]!);
      relSeq += 1;
      relations.push(
        normalizeUsecaseRelation({
          id: `relation-${relSeq}` as UsecaseRelationId,
          from: labelled[1]! as UsecaseNodeId,
          to: labelled[6]! as UsecaseNodeId,
          line: "solid",
          headFrom,
          headTo,
          ...(text !== "" ? { label: unescapeLabel(text) } : {}),
        }),
      );
      continue;
    }

    const plain = rel.match(new RegExp(`^(${N})\\s*${PLAIN_OP}\\s*(${N})$`));
    if (plain) {
      const { headFrom, headTo } = headsOf(plain[2]!);
      touch(plain[1]!);
      touch(plain[3]!);
      relSeq += 1;
      relations.push(
        normalizeUsecaseRelation({
          id: `relation-${relSeq}` as UsecaseRelationId,
          from: plain[1]! as UsecaseNodeId,
          to: plain[3]! as UsecaseNodeId,
          line: "solid",
          headFrom,
          headTo,
        }),
      );
      continue;
    }

    if (declaration(line, undefined)) continue;

    errors.push({ line: lineNo, message: `cannot parse: ${line}` });
  }

  /** Element declaration, also used for a boundary's own metadata statement.
   * Returns false when the line is not a declaration at all. */
  function declaration(text: string, boundary: BoundaryId | undefined): boolean {
    const m = text.match(
      new RegExp(`^(?:(actor)\\s+)?(?:"([^"]*)"|(${N})(?:\\(([^)]*)\\)|\\[([^\\]]*)\\])?)\\s*(?:@\\{([^}]*)\\})?\\s*(?:<<([^>]*)>>)?$`),
    );
    if (!m) return false;
    const quoted = m[2];
    const name = quoted !== undefined ? derivedName(readLabel(quoted)) : m[3]!;
    const rawLabel = quoted ?? m[4] ?? m[5];
    const meta = parseMetadata(m[6] ?? "");

    // A bare `Name@{ … }` statement re-targets something already declared:
    // a boundary (`Payment_service@{ type: package }`), an element, or — when
    // nothing carries that name — an edge id, whose metadata has no IR.
    if (m[1] === undefined && rawLabel === undefined && m[6] !== undefined) {
      const target = boundaries.findIndex((b) => b.name === name);
      if (target >= 0) {
        if (meta.type !== undefined) {
          boundaries[target] = { ...boundaries[target]!, type: meta.type === "package" ? "package" : "default" };
        }
        return true;
      }
      // `starts@{ animation: fast }` targets an edge id: no IR, dropped
      if (!nodes.has(name) && !meta.element) return true;
    }

    const rec = touch(name);
    if (m[1] !== undefined) rec.isActor = true;
    if (rawLabel !== undefined) {
      const label = readLabel(rawLabel);
      // a label identical to the identifier is what mermaid shows anyway
      if (label !== name) rec.label = label;
      if (m[5] !== undefined) rec.shape = "rect";
    }
    if (meta.type === "hollow" || meta.type === "awesome") rec.variant = meta.type;
    if (meta.business === true) rec.business = true;
    if (m[7] !== undefined) rec.stereotype = m[7].trim();
    if (boundary !== undefined) rec.boundary = boundary;
    if (rec.isActor && rec.variant === "awesome") delete rec.business; // mermaid rejects the pairing
    if (!rec.isActor && rec.shape === "rect") delete rec.business;
    return true;
  }

  if (openBoundary !== null) {
    errors.push({ line: openBoundary.line, message: `unclosed systemBoundary: ${openBoundary.name}` });
  }
  if (!headerSeen) errors.push({ line: 1, message: "empty diagram: missing header" });
  if (errors.length > 0) return { ok: false, errors };

  const actors: UsecaseActor[] = [];
  const usecases: UseCase[] = [];
  for (const name of order) {
    const rec = nodes.get(name)!;
    const common = {
      name: rec.name,
      ...(rec.label !== undefined ? { label: rec.label } : {}),
      ...(rec.business === true ? { business: true as const } : {}),
      ...(rec.stereotype !== undefined ? { stereotype: rec.stereotype } : {}),
      ...(rec.boundary !== undefined ? { boundary: rec.boundary } : {}),
    };
    if (rec.isActor) actors.push({ id: name as ActorId, variant: rec.variant, ...common });
    else usecases.push({ id: name as UseCase["id"], shape: rec.shape, ...common });
  }

  return {
    ok: true,
    ir: {
      kind: "usecase",
      ...(direction !== undefined ? { direction } : {}),
      actors,
      usecases,
      boundaries,
      relations,
      notes,
    },
  };
}
