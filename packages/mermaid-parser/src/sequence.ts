import type {
  Activation,
  ActivationId,
  Box,
  BoxId,
  Branch,
  BranchId,
  Fragment,
  FragmentId,
  FragmentKind,
  Lifecycle,
  LifecycleId,
  Lifeline,
  LifelineId,
  LoopBounds,
  Message,
  MessageArrowType,
  MessageId,
  Note,
  NoteId,
  ParticipantKind,
  SequenceEvent,
  SequenceIR,
} from "@gmermaid/ir";
import { isColorToken, PARTICIPANT_KINDS } from "@gmermaid/ir";
import { dropList, droppedWarning, prepareLines, unescapeLabel, type ParseError, type ParseResult, type ParseWarning } from "./common";

// Dialect the IR cannot hold is DISCARDED by design, same as `%%` comments:
// frontmatter, `%%{init}%%` directives, `title`, `accTitle` / `accDescr`,
// trailing `;` terminators, `@{ … }` participant metadata other than `type`,
// the `link` / `links` / `properties` actor menus — and `autonumber off`,
// which the IR cannot express (it only says "numbered, from n by m", or
// nothing at all). It is dropped like the rest: a diagram that only turns
// numbering off reopens identically, one that turns it off after an
// `autonumber` comes back numbered. Both report a warning.

const DROPPED = dropList({ extra: ["title", "link", "links", "properties"] });

// mermaid actor ids may hold any letter/digit (incl. non-ASCII), `_`, `-`, `.`
const ID = "[\\p{L}\\p{N}_.-]+";
const ID_RE = new RegExp(`^${ID}$`, "u");

// longest-first so "-->>" wins over "-->" and "->" (earliest match in the
// line wins; ties fall back to this list order via the stable sort)
const ARROWS: readonly { token: string; arrow: MessageArrowType }[] = [
  { token: "<<-->>", arrow: "dottedBidirectional" },
  { token: "<<->>", arrow: "bidirectional" },
  { token: "-->>", arrow: "dotted" },
  { token: "->>", arrow: "solid" },
  { token: "-->", arrow: "dottedOpen" },
  { token: "->", arrow: "solidOpen" },
  { token: "--)", arrow: "dottedAsync" },
  { token: "-)", arrow: "async" },
  { token: "--x", arrow: "dottedCross" },
  { token: "-x", arrow: "cross" },
];

const FRAGMENT_KINDS: readonly FragmentKind[] = ["alt", "opt", "loop", "par", "break", "critical", "rect"];

/** `rgb(1, 2, 3) Title` / `Aqua Title` / `Title` → color + title, mirroring
 * mermaid's parseBoxData (an unrecognised leading word is part of the title). */
function splitColorPrefix(raw: string): { color?: string; rest: string } {
  const fn = raw.match(/^((?:rgba?|hsla?)\s*\([^)]*\))\s*(.*)$/i);
  if (fn) return { color: fn[1]!.replaceAll(/\s+/g, ""), rest: fn[2]!.trim() };
  const word = raw.match(/^(\S+)\s*(.*)$/);
  if (word && isColorToken(word[1]!)) return { color: word[1]!, rest: word[2]!.trim() };
  return { rest: raw.trim() };
}

/** `(min,max) exit` → structured bounds + exit text. A bare `(,)` prefix
 * with both fields empty is left alone — codegen never emits it. */
function splitLoopSpec(raw: string): { condition: string; loopBounds?: LoopBounds } {
  const m = raw.match(/^\((\d*)\s*,\s*(\d*)\)\s*(.*)$/);
  if (!m || (m[1] === "" && m[2] === "")) return { condition: raw };
  return { condition: m[3]!, loopBounds: { min: m[1]!, max: m[2]! } };
}

/** `@{ "type": "database" }` / `@{ type: db }` — only `type` has an IR home;
 * every other metadata key is dropped like styling is. */
function participantKindOf(metadata: string | undefined): ParticipantKind | undefined {
  if (metadata === undefined) return undefined;
  const m = metadata.match(/["']?type["']?\s*:\s*["']?([\w-]+)["']?/);
  if (!m) return undefined;
  const raw = m[1]!.toLowerCase();
  const normalized = raw === "db" ? "database" : raw;
  return (PARTICIPANT_KINDS as readonly string[]).includes(normalized) ? (normalized as ParticipantKind) : undefined;
}

// `participant X@{ … } as Alias` — metadata sits BEFORE `as`, which is the
// only order mermaid 11.16 reads as metadata (after `as` it is alias text).
const DECL_TAIL = `(${ID})(?:@\\{([^}]*)\\})?(?:\\s+as\\s+(.+))?`;

export function parseSequence(code: string): ParseResult<SequenceIR> {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  const lines = prepareLines(code, { drop: DROPPED, warnings });

  const lifelines: Lifeline[] = [];
  const seen = new Set<string>();
  let msgSeq = 0;
  let fragSeq = 0;
  let branchSeq = 0;
  let noteSeq = 0;
  let actSeq = 0;
  let lifeSeq = 0;
  let boxSeq = 0;

  const boxes: Box[] = [];
  let openBox: { id: BoxId; name: string; color?: string; lifelines: LifelineId[] } | undefined;

  const declareLifeline = (id: string, name?: string, kind: ParticipantKind = "participant", explicit = false): void => {
    if (!seen.has(id)) {
      seen.add(id);
      lifelines.push({ id: id as LifelineId, name: name ?? id, kind });
    } else if (explicit) {
      // a later explicit `participant X as Alias` still applies its alias
      const i = lifelines.findIndex((l) => l.id === id);
      if (i >= 0) lifelines[i] = { id: id as LifelineId, name: name ?? id, kind };
    }
    if (openBox && !openBox.lifelines.includes(id as LifelineId)) openBox.lifelines.push(id as LifelineId);
  };

  // Stack of open fragments; events append to the current branch.
  const root: SequenceEvent[] = [];
  interface OpenFragment {
    kind: FragmentKind;
    branches: { id: BranchId; condition: string; loopBounds?: LoopBounds; events: SequenceEvent[] }[];
    id: FragmentId;
    parent: SequenceEvent[];
    openedAt: number;
  }
  const stack: OpenFragment[] = [];
  // `box` and fragments both close with `end`, so one block stack decides
  // which of the two an `end` belongs to.
  const blocks: ("box" | "fragment")[] = [];
  const currentEvents = (): SequenceEvent[] => {
    const top = stack[stack.length - 1];
    return top ? top.branches[top.branches.length - 1]!.events : root;
  };

  let headerSeen = false;
  let autonumber: { start: number; step: number } | undefined;

  for (const { text: line, line: lineNo } of lines) {
    if (!headerSeen) {
      if (line !== "sequenceDiagram") {
        errors.push({ line: lineNo, message: "expected `sequenceDiagram` header" });
        return { ok: false, errors };
      }
      headerSeen = true;
      continue;
    }

    if (/^autonumber\s+off$/.test(line)) {
      warnings.push(droppedWarning("autonumber off", lineNo));
      continue;
    }

    const auto = line.match(/^autonumber(?:\s+(\d+)(?:\s+(\d+))?)?$/);
    if (auto) {
      autonumber = { start: auto[1] !== undefined ? Number(auto[1]) : 1, step: auto[2] !== undefined ? Number(auto[2]) : 1 };
      continue;
    }

    const box = line.match(/^box(?:\s+(.*))?$/);
    if (box) {
      if (openBox) {
        errors.push({ line: lineNo, message: "nested `box`" });
        continue;
      }
      const spec = splitColorPrefix(box[1] ?? "");
      boxSeq += 1;
      openBox = {
        id: `box-${boxSeq}` as BoxId,
        name: unescapeLabel(spec.rest),
        ...(spec.color !== undefined ? { color: spec.color } : {}),
        lifelines: [],
      };
      blocks.push("box");
      continue;
    }

    const part = line.match(new RegExp(`^(participant|actor)\\s+${DECL_TAIL}$`, "u"));
    if (part) {
      const kind = participantKindOf(part[3]) ?? (part[1] === "actor" ? "actor" : "participant");
      declareLifeline(part[2]!, part[4] !== undefined ? unescapeLabel(part[4].trim()) : undefined, kind, true);
      continue;
    }

    const created = line.match(new RegExp(`^create\\s+(?:(participant|actor)\\s+)?${DECL_TAIL}$`, "u"));
    if (created) {
      const kind = participantKindOf(created[3]) ?? (created[1] === "actor" ? "actor" : "participant");
      declareLifeline(created[2]!, created[4] !== undefined ? unescapeLabel(created[4].trim()) : undefined, kind, true);
      lifeSeq += 1;
      const ev: Lifecycle = { kind: "create", id: `lifecycle-${lifeSeq}` as LifecycleId, lifeline: created[2]! as LifelineId };
      currentEvents().push(ev);
      continue;
    }

    const destroyed = line.match(new RegExp(`^destroy\\s+(${ID})$`, "u"));
    if (destroyed) {
      declareLifeline(destroyed[1]!);
      lifeSeq += 1;
      const ev: Lifecycle = { kind: "destroy", id: `lifecycle-${lifeSeq}` as LifecycleId, lifeline: destroyed[1]! as LifelineId };
      currentEvents().push(ev);
      continue;
    }

    const act = line.match(new RegExp(`^(activate|deactivate)\\s+(${ID})$`, "u"));
    if (act) {
      declareLifeline(act[2]!);
      actSeq += 1;
      const ev: Activation = {
        kind: "activation",
        id: `activation-${actSeq}` as ActivationId,
        lifeline: act[2]! as LifelineId,
        on: act[1] === "activate",
      };
      currentEvents().push(ev);
      continue;
    }

    const note = line.match(new RegExp(`^[Nn]ote\\s+(left of|right of|over)\\s+(${ID}(?:\\s*,\\s*${ID})?)\\s*:\\s*(.*)$`, "u"));
    if (note) {
      const position = note[1] === "left of" ? "leftOf" : note[1] === "right of" ? "rightOf" : "over";
      const ids = note[2]!.split(",").map((s) => s.trim());
      for (const id of ids) declareLifeline(id);
      noteSeq += 1;
      const ev: Note = {
        kind: "note",
        id: `note-${noteSeq}` as NoteId,
        position,
        lifelines: ids as unknown as readonly LifelineId[],
        text: unescapeLabel(note[3]!.trim()),
      };
      currentEvents().push(ev);
      continue;
    }

    const frag = line.match(new RegExp(`^(${FRAGMENT_KINDS.join("|")})(?:\\s+(.*))?$`));
    if (frag) {
      const kind = frag[1] as FragmentKind;
      const raw = frag[2] !== undefined ? unescapeLabel(frag[2]) : "";
      // The ONLY place the ambiguous `(min,max) exit` text form is decomposed
      // (B-2): everywhere else loop bounds live structurally on the branch.
      // For `rect` the same slot carries the fill color, verbatim.
      const spec = kind === "loop" ? splitLoopSpec(raw) : { condition: raw };
      fragSeq += 1;
      branchSeq += 1;
      stack.push({
        kind,
        id: `fragment-${fragSeq}` as FragmentId,
        branches: [
          {
            id: `branch-${branchSeq}` as BranchId,
            condition: spec.condition,
            ...(spec.loopBounds !== undefined ? { loopBounds: spec.loopBounds } : {}),
            events: [],
          },
        ],
        parent: currentEvents(),
        openedAt: lineNo,
      });
      blocks.push("fragment");
      continue;
    }

    const alt = line.match(/^(else|and|option)(?:\s+(.*))?$/);
    if (alt) {
      const top = stack[stack.length - 1];
      if (!top) {
        errors.push({ line: lineNo, message: `\`${alt[1]}\` outside a fragment` });
        continue;
      }
      branchSeq += 1;
      top.branches.push({
        id: `branch-${branchSeq}` as BranchId,
        condition: alt[2] !== undefined ? unescapeLabel(alt[2]) : "",
        events: [],
      });
      continue;
    }

    if (line === "end") {
      const block = blocks.pop();
      if (block === undefined) {
        errors.push({ line: lineNo, message: "`end` without an open fragment" });
        continue;
      }
      if (block === "box") {
        if (openBox) boxes.push({ ...openBox, lifelines: openBox.lifelines });
        openBox = undefined;
        continue;
      }
      const top = stack.pop()!;
      const fragment: Fragment = {
        kind: "fragment",
        id: top.id,
        fragmentKind: top.kind,
        branches: top.branches as readonly Branch[],
      };
      top.parent.push(fragment);
      continue;
    }

    // message: A->>B: label, with optional `+`/`-` activation suffix
    const arrowHit = ARROWS.map((a) => ({ a, idx: line.indexOf(a.token) }))
      .filter((x) => x.idx > 0)
      .toSorted((x, y) => x.idx - y.idx)[0];
    if (arrowHit) {
      const from = line.slice(0, arrowHit.idx).trim();
      let rest = line.slice(arrowHit.idx + arrowHit.a.token.length);
      let activate: "start" | "end" | undefined;
      if (rest.startsWith("+")) {
        activate = "start";
        rest = rest.slice(1);
      } else if (rest.startsWith("-")) {
        activate = "end";
        rest = rest.slice(1);
      }
      const colon = rest.indexOf(":");
      const to = (colon >= 0 ? rest.slice(0, colon) : rest).trim();
      const label = colon >= 0 ? unescapeLabel(rest.slice(colon + 1).trim()) : "";
      if (!ID_RE.test(from) || !ID_RE.test(to)) {
        errors.push({ line: lineNo, message: "cannot parse message endpoints" });
        continue;
      }
      declareLifeline(from);
      declareLifeline(to);
      msgSeq += 1;
      const message: Message = {
        kind: "message",
        id: `message-${msgSeq}` as MessageId,
        from: from as LifelineId,
        to: to as LifelineId,
        label,
        arrow: arrowHit.a.arrow,
        ...(activate !== undefined ? { activate } : {}),
      };
      currentEvents().push(message);
      continue;
    }

    errors.push({ line: lineNo, message: `cannot parse: ${line}` });
  }

  if (!headerSeen) errors.push({ line: 1, message: "empty diagram: missing header" });
  for (const open of stack) {
    errors.push({ line: open.openedAt, message: `unclosed \`${open.kind}\` fragment` });
  }
  if (openBox) errors.push({ line: lines[lines.length - 1]?.line ?? 1, message: "unclosed `box`" });
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    warnings,
    ir: {
      kind: "sequence",
      lifelines,
      boxes: boxes.filter((b) => b.lifelines.length > 0),
      events: root,
      ...(autonumber !== undefined ? { autonumber } : {}),
    },
  };
}
