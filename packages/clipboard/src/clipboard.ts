import type { DiagramIR } from "@gmermaid/ir";
import {
  classToMermaid,
  flowchartToMermaid,
  ganttToMermaid,
  journeyToMermaid,
  mindmapToMermaid,
  requirementToMermaid,
  sequenceToMermaid,
  stateToMermaid,
  timelineToMermaid,
  usecaseToMermaid,
} from "@gmermaid/mermaid-codegen";
import { detectDiagramKind, parseDiagram } from "@gmermaid/mermaid-parser";
import type { KindClipboard } from "./kind";
import { classClipboard } from "./class";
import { flowchartClipboard } from "./flowchart";
import { ganttClipboard } from "./gantt";
import { journeyClipboard } from "./journey";
import { mindmapClipboard } from "./mindmap";
import { requirementClipboard } from "./requirement";
import { sequenceClipboard } from "./sequence";
import { stateClipboard } from "./state";
import { timelineClipboard } from "./timeline";
import { usecaseClipboard } from "./usecase";

/**
 * Copy and paste as pure logic — no DOM, no selection state, no view.
 *
 * ## What travels on the clipboard
 *
 * **Mermaid text of the selected sub-diagram**, never a private payload. The
 * IR is the master and the text is a projection of it (ADR 0001), so the
 * clipboard is a projection too: what you copy pastes into any mermaid tool
 * or into our own code pane, and mermaid text copied from anywhere pastes
 * onto the canvas. `copySelection` therefore builds a *sub-IR* and hands it
 * to the kind's existing codegen; `pasteInto` runs the kind's existing
 * parser and merges the result. There is no second emitter and no second
 * grammar.
 *
 * Two consequences fall out of that choice and are accepted, not worked
 * around:
 *
 * - **Only what mermaid can spell survives.** A state diagram's `xstate`
 *   extension (entry/exit, invoke, guards, context, `setup`) has no mermaid
 *   syntax (ADR 0002), so it does not survive a copy. The canvas keeps it on
 *   the original; the pasted copy is the mermaid half.
 * - **Diagram-level settings are copied but never pasted.** A slice carries
 *   the source's `direction` / gantt `dateFormat` etc. so the text reads
 *   correctly on its own, and `pasteInto` ignores them: pasting must not
 *   silently re-orient or re-date the diagram you paste into. Titles are not
 *   copied at all — a title names the whole diagram, not a selection.
 *
 * ## Closure — the real work
 *
 * A selection is rarely a valid diagram on its own, so every slice is closed
 * before it is emitted. The rules, per kind:
 *
 * - **flowchart** — a selected subgraph pulls everything inside it
 *   (recursively). A selected edge pulls both endpoints (an endpoint that is
 *   a subgraph pulls its contents too). A node or subgraph whose parent is
 *   *not* in the selection is promoted to the top level: copying two nodes
 *   out of a group means the nodes, not the group. Finally, edges *induced*
 *   by the selection — both endpoints inside it — come along even when the
 *   edge itself was not selected, because a marquee over a region means the
 *   region's wiring.
 * - **class** — a selected namespace pulls its classes; a selected relation
 *   pulls both classes; a class whose namespace is not selected leaves the
 *   namespace behind. Induced relations come along. A note travels with its
 *   target (and a selected note pulls its target); a free-floating note
 *   travels only when selected.
 * - **state** — a selected state pulls its whole composite subtree, a
 *   selected transition pulls both endpoint states (with their subtrees), and
 *   a state whose parent is not selected is promoted to the top level,
 *   losing its `region`. Because `[*]` is scoped to one start and one end per
 *   container region, promoting several of them would be illegal: the first
 *   survives and the duplicates' transitions are re-pointed onto it. Induced
 *   transitions come along; notes travel with their target, and never on a
 *   `[*]` (it has no name in the text).
 * - **sequence** — a selected *branch* resolves to its whole fragment: half
 *   an `alt` is not a diagram. A selected fragment travels whole, with every
 *   branch and every event inside it. An event whose enclosing fragment is
 *   *not* selected is lifted to the top level, keeping document order — the
 *   same "the group stays behind" rule as flowchart. Every lifeline a
 *   surviving event names comes along, in source order, and a `box` comes
 *   along pruned to its surviving members. Two mermaid rules are then
 *   enforced on the slice: `create`/`destroy` are dropped unless the message
 *   that justifies them survived, and activation is re-balanced (an
 *   `activate` with no `deactivate`, or a `->>-` whose `->>+` stayed behind,
 *   is dropped) — otherwise the copied text would not parse at all.
 * - **requirement** / **usecase** — a selected relation pulls both ends;
 *   induced relations come along. A selected usecase boundary pulls its
 *   members; a member whose boundary is not selected leaves it behind. Notes
 *   travel with their target.
 * - **journey** / **timeline** / **gantt** — the *opposite* containment rule
 *   to the graph kinds: a selected task/period/event keeps its `section`,
 *   pruned to the selected members. A section is these kinds' spine, and only
 *   the very first one is allowed to be unnamed, so "promote to the top
 *   level" is not a thing a task can do. A selected section pulls all its
 *   members. Gantt additionally closes over dependencies: `after a b` /
 *   `until a b` name other tasks, so those tasks (and their sections) are
 *   pulled in transitively — a gantt dependency is an edge like any other.
 * - **mindmap** — a selected node pulls its whole subtree. A mindmap is a
 *   *single rooted tree*, so a selection that closes to two or more disjoint
 *   subtrees cannot be expressed at all: that is the one selection this
 *   module refuses with `undefined`, rather than inventing a root to hang
 *   them from.
 *
 * ## What paste guarantees
 *
 * - **Fresh ids, always** — every element is re-minted through `newId`, and
 *   references inside the pasted set are re-pointed. Pasting twice gives two
 *   copies. References out of the set are dropped; where dropping one would
 *   be meaningless (a gantt task whose `until` names nothing that came
 *   along) the element is dropped, and if that empties the paste it is
 *   refused with a reason.
 * - **Kind must match** — a sequence diagram pasted into a flowchart is a
 *   refusal carrying a sentence the caller can show, never a crash.
 * - **One uniqueness rule** — names that *are* the identity in mermaid text
 *   (class + namespace names, requirement/element names, actor / use case /
 *   boundary names, lifeline names, gantt task ids) get the first free
 *   `_2`, `_3`, … suffix. `_` and digits are inside every one of those name
 *   grammars, so the rule is the same everywhere. Ids that are *generated*
 *   identities (flowchart nodes, state ids) need no suffix: they are minted
 *   fresh and cannot collide.
 * - **Foreign text is data, not a crash** — anything unparseable is a
 *   refusal carrying the parse error.
 * - **The reducers' invariants still hold** — the merged result runs through
 *   the very normalizers the GUI actions use (`normalizeFlowchartEdge`,
 *   `normalizeSequenceNote`, `normalizeFragment`, `normalizeUsecaseRelation`,
 *   the name regexes and the `*Rejection` predicates), so a paste cannot
 *   reach a state the GUI would refuse to create.
 *
 * Pasting has no anchor — the signature takes no target — so pasted content
 * lands at the top level (or, for a mindmap, under the existing root) and
 * `added` tells the caller what to select.
 */

/** The text form of a selection, ready for the system clipboard. */
export function copySelection(ir: DiagramIR, ids: readonly string[]): string | undefined {
  if (ids.length === 0) return undefined;
  const set = new Set<string>(ids);
  switch (ir.kind) {
    case "flowchart": {
      const s = flowchartClipboard.slice(ir, set);
      return s && flowchartToMermaid(s);
    }
    case "sequence": {
      const s = sequenceClipboard.slice(ir, set);
      return s && sequenceToMermaid(s);
    }
    case "class": {
      const s = classClipboard.slice(ir, set);
      return s && classToMermaid(s);
    }
    case "state": {
      const s = stateClipboard.slice(ir, set);
      return s && stateToMermaid(s);
    }
    case "requirement": {
      const s = requirementClipboard.slice(ir, set);
      return s && requirementToMermaid(s);
    }
    case "journey": {
      const s = journeyClipboard.slice(ir, set);
      return s && journeyToMermaid(s);
    }
    case "timeline": {
      const s = timelineClipboard.slice(ir, set);
      return s && timelineToMermaid(s);
    }
    case "gantt": {
      const s = ganttClipboard.slice(ir, set);
      return s && ganttToMermaid(s);
    }
    case "mindmap": {
      const s = mindmapClipboard.slice(ir, set);
      return s && mindmapToMermaid(s);
    }
    case "usecase": {
      const s = usecaseClipboard.slice(ir, set);
      return s && usecaseToMermaid(s);
    }
  }
}

export type PasteResult =
  | { readonly ok: true; readonly ir: DiagramIR; readonly added: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/** Merge a copied selection into `ir`. `text` is whatever was on the
 * clipboard, so it may be foreign or nonsense. */
export function pasteInto(ir: DiagramIR, text: string): PasteResult {
  if (text.trim() === "") return { ok: false, reason: "the clipboard is empty" };

  const kind = detectDiagramKind(text);
  if (kind === undefined) {
    return { ok: false, reason: "the clipboard does not hold a mermaid diagram" };
  }
  if (kind !== ir.kind) {
    return { ok: false, reason: `cannot paste a ${KIND_LABEL[kind]} into a ${KIND_LABEL[ir.kind]}` };
  }

  const parsed = parseDiagram(kind, text);
  if (!parsed.ok) {
    const first = parsed.errors[0];
    return { ok: false, reason: first === undefined ? "the clipboard is not valid mermaid" : `line ${first.line}: ${first.message}` };
  }

  // kind === ir.kind === parsed.ir.kind, so the pair lines up; TypeScript
  // cannot see it through the union, hence the one cast per kind below.
  const merged = (CLIPBOARDS[kind] as KindClipboard<DiagramIR>).merge(ir, parsed.ir as DiagramIR);
  return "reason" in merged ? { ok: false, reason: merged.reason } : { ok: true, ir: merged.ir, added: merged.added };
}

const CLIPBOARDS = {
  flowchart: flowchartClipboard,
  sequence: sequenceClipboard,
  class: classClipboard,
  state: stateClipboard,
  requirement: requirementClipboard,
  journey: journeyClipboard,
  timeline: timelineClipboard,
  gantt: ganttClipboard,
  mindmap: mindmapClipboard,
  usecase: usecaseClipboard,
} as const;

const KIND_LABEL = {
  flowchart: "flowchart",
  sequence: "sequence diagram",
  class: "class diagram",
  state: "state diagram",
  requirement: "requirement diagram",
  journey: "user journey",
  timeline: "timeline",
  gantt: "gantt chart",
  mindmap: "mindmap",
  usecase: "use case diagram",
} as const;
