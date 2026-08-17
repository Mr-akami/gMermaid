import type {
  Branch,
  BranchId,
  Fragment,
  FragmentId,
  FragmentKind,
  Lifeline,
  LifelineId,
  Message,
  MessageArrowType,
  MessageId,
  Note,
  NoteId,
  SequenceEvent,
  SequenceIR,
} from "@gmermaid/ir";
import { unescapeLabel, type ParseError, type ParseResult } from "./common";

const ID = "[A-Za-z0-9_-]+";

// longest-first so "-->>" wins over "-->" and "->"
const ARROWS: readonly { token: string; arrow: MessageArrowType }[] = [
  { token: "-->>", arrow: "dotted" },
  { token: "->>", arrow: "solid" },
  { token: "-->", arrow: "dottedOpen" },
  { token: "->", arrow: "solidOpen" },
  { token: "-)", arrow: "async" },
];

const FRAGMENT_KINDS: readonly FragmentKind[] = ["alt", "opt", "loop", "par"];

export function parseSequence(code: string): ParseResult<SequenceIR> {
  const errors: ParseError[] = [];
  const lines = code.split("\n");

  const lifelines: Lifeline[] = [];
  const seen = new Set<string>();
  let msgSeq = 0;
  let fragSeq = 0;
  let branchSeq = 0;
  let noteSeq = 0;

  const declareLifeline = (id: string, name?: string, isActor = false, explicit = false): void => {
    if (seen.has(id)) {
      // a later explicit `participant X as Alias` still applies its alias
      if (explicit) {
        const i = lifelines.findIndex((l) => l.id === id);
        if (i >= 0) lifelines[i] = { id: id as LifelineId, name: name ?? id, isActor };
      }
      return;
    }
    seen.add(id);
    lifelines.push({ id: id as LifelineId, name: name ?? id, isActor });
  };

  // Stack of open fragments; events append to the current branch.
  const root: SequenceEvent[] = [];
  interface OpenFragment {
    kind: FragmentKind;
    branches: { id: BranchId; condition: string; events: SequenceEvent[] }[];
    id: FragmentId;
    parent: SequenceEvent[];
    openedAt: number;
  }
  const stack: OpenFragment[] = [];
  const currentEvents = (): SequenceEvent[] => {
    const top = stack[stack.length - 1];
    return top ? top.branches[top.branches.length - 1]!.events : root;
  };

  let headerSeen = false;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i]!.trim();
    if (line === "" || line.startsWith("%%")) continue;

    if (!headerSeen) {
      if (line !== "sequenceDiagram") {
        errors.push({ line: lineNo, message: "expected `sequenceDiagram` header" });
        return { ok: false, errors };
      }
      headerSeen = true;
      continue;
    }

    const part = line.match(new RegExp(`^(participant|actor)\\s+(${ID})(?:\\s+as\\s+(.+))?$`));
    if (part) {
      declareLifeline(part[2]!, part[3] !== undefined ? unescapeLabel(part[3]) : undefined, part[1] === "actor", true);
      continue;
    }

    const note = line.match(new RegExp(`^[Nn]ote\\s+(left of|right of|over)\\s+(${ID}(?:\\s*,\\s*${ID})?)\\s*:\\s*(.*)$`));
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
      fragSeq += 1;
      branchSeq += 1;
      stack.push({
        kind: frag[1] as FragmentKind,
        id: `fragment-${fragSeq}` as FragmentId,
        branches: [
          {
            id: `branch-${branchSeq}` as BranchId,
            condition: frag[2] !== undefined ? unescapeLabel(frag[2]) : "",
            events: [],
          },
        ],
        parent: currentEvents(),
        openedAt: lineNo,
      });
      continue;
    }

    const alt = line.match(/^(else|and)(?:\s+(.*))?$/);
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
      const top = stack.pop();
      if (!top) {
        errors.push({ line: lineNo, message: "`end` without an open fragment" });
        continue;
      }
      const fragment: Fragment = {
        kind: "fragment",
        id: top.id,
        fragmentKind: top.kind,
        branches: top.branches as readonly Branch[],
      };
      top.parent.push(fragment);
      continue;
    }

    // message: A->>B: label
    const arrowHit = ARROWS.map((a) => ({ a, idx: line.indexOf(a.token) }))
      .filter((x) => x.idx > 0)
      .toSorted((x, y) => x.idx - y.idx)[0];
    if (arrowHit) {
      const from = line.slice(0, arrowHit.idx).trim();
      const rest = line.slice(arrowHit.idx + arrowHit.a.token.length);
      const colon = rest.indexOf(":");
      const to = (colon >= 0 ? rest.slice(0, colon) : rest).trim();
      const label = colon >= 0 ? unescapeLabel(rest.slice(colon + 1).trim()) : "";
      if (!new RegExp(`^${ID}$`).test(from) || !new RegExp(`^${ID}$`).test(to)) {
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
  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, ir: { kind: "sequence", lifelines, events: root } };
}
