import {
  omitUndefined,
  type StateId,
  type StateIR,
  type StateMachineXState,
  type StateNode,
  type StateNodeXState,
  type StateTransition,
  type StateTransitionXState,
  type TransitionId,
  type XValue,
} from "@gmermaid/ir";
import { STATE_RESERVED_IDS, type ParseError, type ParseResult, type ParseWarning } from "@gmermaid/mermaid-parser";
import { readMachineSource, type XObject } from "./read";
import { formatRef, formatTransitionLabel, type XRef } from "./signature";

// XState machine config → StateIR. The IR is the master (ADR 0001 / 0002), so
// this is the import half of the XState projection; `fromIR.ts` is the export
// half, and the two are tested as inverses.
//
// Two passes, because XState targets may point forwards and `#id` may point
// anywhere: pass 1 mints every state node, pass 2 wires the transitions.

/** State-node keys we understand. Anything else is refused BY NAME rather
 * than ignored — a silently dropped `invoke` is a deleted behaviour. */
const NODE_KEYS: ReadonlySet<string> = new Set([
  "id",
  "initial",
  "states",
  "type",
  "history",
  "target",
  "entry",
  "exit",
  "on",
  "always",
  "after",
  "invoke",
  "onDone",
  "meta",
  "description",
  "output",
  "tags",
]);
const ROOT_KEYS: ReadonlySet<string> = new Set(
  [...NODE_KEYS, "types"].filter((k) => k !== "history" && k !== "target"),
);
const TRANSITION_KEYS: ReadonlySet<string> = new Set(["target", "guard", "actions", "reenter", "description"]);

const STATE_CHAR = /[\p{L}\p{N}_.]/u;
const STATE_HEAD = /[\p{L}_]/u;

/** A key from the machine, made spellable as a mermaid state id. */
function sanitizeId(key: string): string {
  const body = [...key].map((c) => (STATE_CHAR.test(c) ? c : "_")).join("");
  const head = body.length > 0 && STATE_HEAD.test(body[0]!) ? body : `stt_${body}`;
  return STATE_RESERVED_IDS.includes(head) ? `stt_${head}` : head;
}

const sub = (path: string, key: string): string => (path === "" ? key : `${path}.${key}`);

/** Follow a dotted key path down the walked tree. */
function descend(start: Walked | undefined, keys: readonly string[]): Walked | undefined {
  let cur = start;
  for (const k of keys) {
    if (cur === undefined) return undefined;
    cur = cur.byKey.get(k);
  }
  return cur;
}

/** One state node of the machine, resolved far enough to hand out ids. */
interface Walked {
  readonly key: string;
  readonly node: XObject;
  readonly path: string;
  /** Empty for the machine root, which has no box on the canvas. */
  readonly irId?: StateId;
  readonly children: Walked[];
  readonly byKey: Map<string, Walked>;
  /** The `[*]` this node's `initial` becomes, when it has one. */
  startPseudo?: StateId;
  parent?: Walked;
}

const str = (v: XValue | undefined): string | undefined => (typeof v === "string" ? v : undefined);
const asArray = (v: XValue | undefined): readonly XValue[] | undefined =>
  v === undefined ? undefined : Array.isArray(v) ? v : [v];
const isObject = (v: XValue | undefined): v is XObject => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: XValue | undefined): readonly string[] | undefined => {
  const list = asArray(v);
  return list === undefined ? undefined : list.filter((x): x is string => typeof x === "string");
};

interface RawTransition {
  readonly target?: string;
  readonly guard?: XRef;
  readonly actions: readonly XRef[];
  readonly reenter?: true;
  readonly description?: string;
  readonly path: string;
}

export function parseXStateMachine(code: string): ParseResult<StateIR> {
  const read = readMachineSource(code);
  if (!read.ok) return { ok: false, errors: read.errors };
  const { config, setup, context, lines } = read.value;

  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  const lineAt = (path: string): number => lines[path] ?? 1;
  const fail = (path: string, message: string): void => {
    errors.push({ line: lineAt(path), message: path === "" ? message : `${path}: ${message}` });
  };
  const warn = (path: string, message: string): void => {
    warnings.push({ line: lineAt(path), message: path === "" ? message : `${path}: ${message}` });
  };

  const states: StateNode[] = [];
  const transitions: StateTransition[] = [];
  const usedIds = new Set<string>();
  const byXid = new Map<string, Walked>();

  function mintId(preferred: string, fallback?: string): StateId {
    for (const c of fallback === undefined ? [preferred] : [preferred, fallback]) {
      if (!usedIds.has(c)) {
        usedIds.add(c);
        return c as StateId;
      }
    }
    for (let n = 2; ; n++) {
      const c = `${preferred}_${n}`;
      if (!usedIds.has(c)) {
        usedIds.add(c);
        return c as StateId;
      }
    }
  }

  /** Mermaid's own name for a `[*]`, so the two projections agree on ids. */
  function pseudoId(role: "start" | "end", parent: StateId | undefined, region: number): StateId {
    const base =
      parent === undefined ? `state_${role}` : region > 0 ? `state_${role}_${parent}_r${region}` : `state_${role}_${parent}`;
    return mintId(base);
  }

  function checkKeys(node: XObject, path: string, allowed: ReadonlySet<string>): void {
    for (const k of Object.keys(node)) {
      if (!allowed.has(k)) fail(sub(path, k), `unknown key \`${k}\``);
    }
  }

  /** `"log"` / `{ type, params }` → the signature form the label carries. */
  function toRef(v: XValue, path: string, extraHint = ""): XRef | undefined {
    if (typeof v === "string") return { type: v };
    if (isObject(v) && typeof v.type === "string") {
      const extra = Object.keys(v).filter((k) => k !== "type" && k !== "params");
      if (extra.length > 0) {
        fail(path, `\`${extra[0]}\` is not allowed beside \`type\` — XState v5 carries extra data under \`params\``);
        return undefined;
      }
      return v.params === undefined ? { type: v.type } : { type: v.type, params: v.params };
    }
    fail(path, `expected a name or \`{ type, params }\` — implementations live in \`setup({ … })\`${extraHint}`);
    return undefined;
  }

  function toRefs(v: XValue | undefined, path: string): XRef[] {
    const list = asArray(v) ?? [];
    const out: XRef[] = [];
    list.forEach((item, i) => {
      const ref = toRef(item, list.length > 1 ? `${path}[${i}]` : path);
      if (ref !== undefined) out.push(ref);
    });
    return out;
  }

  function actionSignatures(v: XValue | undefined, path: string): readonly string[] | undefined {
    const refs = toRefs(v, path);
    return refs.length > 0 ? refs.map(formatRef) : undefined;
  }

  // ---- pass 1: every state node, with its id, role and XState detail ------

  function walk(key: string, node: XObject, path: string, parent: Walked, region: number): Walked {
    checkKeys(node, path, NODE_KEYS);
    const type = str(node.type);
    if (type !== undefined && !["parallel", "final", "history"].includes(type)) {
      fail(sub(path, "type"), `unknown state type \`${type}\` — XState v5 knows \`parallel\`, \`final\` and \`history\``);
    }
    const childKeys = isObject(node.states) ? Object.keys(node.states) : [];
    const isParallel = type === "parallel";
    const parentId = parent.irId;

    // `type: "final"` is mermaid's `[*]` end — but a region has only one, so
    // a second final state has to be an ordinary box carrying a flag.
    const endTaken = states.some((s) => s.role === "end" && s.parent === parentId && (s.region ?? 0) === region);
    const asEnd = type === "final" && !endTaken;
    const role: StateNode["role"] = asEnd ? "end" : "normal";
    const irId = asEnd
      ? pseudoId("end", parentId, region)
      : mintId(sanitizeId(key), parentId === undefined ? undefined : sanitizeId(`${parentId}_${key}`));
    const description = str(node.description);
    const xid = str(node.id);

    const xs = omitUndefined({
      key: key === (irId as string) ? undefined : key,
      xid: xid === undefined || xid === (irId as string) ? undefined : xid,
      entry: actionSignatures(node.entry, sub(path, "entry")),
      exit: actionSignatures(node.exit, sub(path, "exit")),
      invoke: asArray(node.invoke),
      onDone: asArray(node.onDone),
      tags: strings(node.tags),
      meta: node.meta,
      description: role === "end" ? description : undefined,
      output: node.output,
      final: type === "final" && !asEnd ? (true as const) : undefined,
      history: type === "history" ? ((str(node.history) as "shallow" | "deep" | undefined) ?? "shallow") : undefined,
      historyTarget: type === "history" ? str(node.target) : undefined,
      parallel: isParallel && childKeys.length < 2 ? (true as const) : undefined,
    }) as StateNodeXState;

    states.push(
      omitUndefined({
        id: irId,
        label: role === "end" ? "" : (description ?? (irId as string)),
        role,
        parent: parentId,
        region: region > 0 ? region : undefined,
        xstate: Object.keys(xs).length > 0 ? xs : undefined,
      }) as StateNode,
    );

    const walked: Walked = { key, node, path, irId, children: [], byKey: new Map(), parent };
    if (xid !== undefined) byXid.set(xid, walked);
    walkChildren(walked, isParallel, childKeys);
    return walked;
  }

  function walkChildren(owner: Walked, isParallel: boolean, childKeys: readonly string[]): void {
    const node = owner.node;
    if (childKeys.length === 0) {
      if (node.initial !== undefined) fail(sub(owner.path, "initial"), "`initial` needs child `states`");
      return;
    }
    if (isParallel) {
      if (node.initial !== undefined) warn(sub(owner.path, "initial"), "`initial` has no meaning on a parallel state and was dropped");
    } else if (node.initial === undefined) {
      warn(sub(owner.path, "states"), "a compound state with no `initial` — XState refuses to start such a machine");
    } else {
      owner.startPseudo = pseudoId("start", owner.irId, 0);
      states.push(omitUndefined({ id: owner.startPseudo, label: "", role: "start" as const, parent: owner.irId }) as StateNode);
    }
    const childStates = node.states as XObject;
    childKeys.forEach((ck, i) => {
      const child = childStates[ck];
      const childPath = sub(owner.path, `states.${ck}`);
      if (!isObject(child)) {
        fail(childPath, "a state must be an object literal");
        return;
      }
      const walkedChild = walk(ck, child, childPath, owner, isParallel ? i : 0);
      owner.children.push(walkedChild);
      owner.byKey.set(ck, walkedChild);
    });
  }

  checkKeys(config, "", ROOT_KEYS);
  if (str(config.type) === "parallel") {
    return {
      ok: false,
      errors: [
        {
          line: lineAt("type"),
          message:
            "a parallel machine root is not supported — mermaid has no container to draw its regions in; wrap them in one state",
        },
      ],
    };
  }
  const root: Walked = { key: "", node: config, path: "", children: [], byKey: new Map() };
  walkChildren(root, false, isObject(config.states) ? Object.keys(config.states) : []);

  // ---- pass 2: transitions, now that every target exists -------------------

  function resolveTarget(target: string, from: Walked, path: string): StateId | undefined {
    if (target.startsWith("#")) {
      const [head = "", ...rest] = target.slice(1).split(".");
      const anchor = byXid.get(head) ?? (str(config.id) === head ? root : undefined);
      const hit = descend(anchor, rest);
      if (hit?.irId === undefined) fail(path, `unknown target \`${target}\` — no state carries \`id: "${head}"\``);
      return hit?.irId;
    }
    if (target.startsWith(".")) {
      const hit = descend(from, target.slice(1).split("."));
      if (hit?.irId === undefined) fail(path, `unknown target \`${target}\` — \`${from.key || "the machine"}\` has no such child`);
      return hit?.irId;
    }
    const hit = descend(from.parent ?? root, target.split("."));
    if (hit?.irId === undefined) fail(path, `unknown target \`${target}\``);
    return hit?.irId;
  }

  function rawTransitions(v: XValue | undefined, path: string): RawTransition[] {
    if (v === undefined) return [];
    const list = Array.isArray(v) ? v : [v];
    const out: RawTransition[] = [];
    list.forEach((item, i) => {
      const at = Array.isArray(v) && v.length > 1 ? `${path}[${i}]` : path;
      if (typeof item === "string") {
        out.push({ target: item, actions: [], path: at });
        return;
      }
      if (!isObject(item)) {
        fail(at, "a transition is a target string or an object `{ target, guard, actions }`");
        return;
      }
      for (const k of Object.keys(item)) {
        if (!TRANSITION_KEYS.has(k)) fail(sub(at, k), `unknown transition key \`${k}\``);
      }
      out.push(
        omitUndefined({
          target: str(item.target),
          // `and()`/`or()`/`not()`/`stateIn()` are CALLS, so the reader has
          // already refused them; say so where the user wrote the guard.
          guard:
            item.guard === undefined
              ? undefined
              : toRef(item.guard, sub(at, "guard"), " — `and()`, `or()`, `not()` and `stateIn()` are calls, so they are out of the subset"),
          actions: toRefs(item.actions, sub(at, "actions")),
          reenter: item.reenter === true ? (true as const) : undefined,
          description: str(item.description),
          path: at,
        }) as RawTransition,
      );
    });
    return out;
  }

  let transSeq = 0;
  function pushTransition(w: Walked, raw: RawTransition, label: string | undefined): void {
    const from = w.irId!;
    // no `target` at all is XState's internal transition: it only runs
    // actions. The IR holds it as a self-transition so the canvas has an
    // arrow to show, and the flag keeps the projection exact.
    const to = raw.target === undefined ? from : resolveTarget(raw.target, w, raw.path);
    if (to === undefined) return;
    transSeq += 1;
    const xs = omitUndefined({
      internal: raw.target === undefined ? (true as const) : undefined,
      reenter: raw.reenter,
      description: raw.description,
    }) as StateTransitionXState;
    transitions.push(
      omitUndefined({
        id: `transition-${transSeq}` as TransitionId,
        from,
        to,
        label,
        xstate: Object.keys(xs).length > 0 ? xs : undefined,
      }) as StateTransition,
    );
  }

  function emitTransitions(w: Walked): void {
    const node = w.node;
    if (w.irId === undefined) {
      if (node.always !== undefined || node.after !== undefined || node.on !== undefined) {
        fail("on", "transitions on the machine root are not supported — mermaid has no state to draw them from");
      }
    } else {
      for (const raw of rawTransitions(node.always, sub(w.path, "always"))) {
        pushTransition(w, raw, formatTransitionLabel({ ...(raw.guard ? { guard: raw.guard } : {}), actions: raw.actions }));
      }
      if (node.after !== undefined) {
        if (!isObject(node.after)) fail(sub(w.path, "after"), "`after` is an object keyed by delay");
        else {
          for (const [delayKey, value] of Object.entries(node.after)) {
            const delay = /^\d+$/.test(delayKey) ? Number(delayKey) : delayKey;
            for (const raw of rawTransitions(value, sub(w.path, `after.${delayKey}`))) {
              pushTransition(w, raw, formatTransitionLabel({ delay, ...(raw.guard ? { guard: raw.guard } : {}), actions: raw.actions }));
            }
          }
        }
      }
      if (node.on !== undefined) {
        if (!isObject(node.on)) fail(sub(w.path, "on"), "`on` is an object keyed by event");
        else {
          for (const [event, value] of Object.entries(node.on)) {
            for (const raw of rawTransitions(value, sub(w.path, `on.${event}`))) {
              pushTransition(w, raw, formatTransitionLabel({ event, ...(raw.guard ? { guard: raw.guard } : {}), actions: raw.actions }));
            }
          }
        }
      }
    }
    // `initial` is the `[*] -->` of this block — emitted after the node's own
    // transitions so a re-read rebuilds the same array order.
    if (w.startPseudo !== undefined) {
      const initial = str(node.initial);
      if (initial === undefined) fail(sub(w.path, "initial"), "`initial` must be a state key");
      else {
        // `initial` names a CHILD, not a sibling — a different scope from
        // every other target in the config
        const hit = descend(w, initial.replace(/^\./, "").split("."));
        const to = hit?.irId;
        if (to === undefined) fail(sub(w.path, "initial"), `unknown initial state \`${initial}\``);
        else {
          transSeq += 1;
          transitions.push({ id: `transition-${transSeq}` as TransitionId, from: w.startPseudo, to });
        }
      }
    }
    for (const c of w.children) emitTransitions(c);
  }

  emitTransitions(root);

  const machine = omitUndefined({
    id: str(config.id),
    context,
    setup,
    entry: actionSignatures(config.entry, "entry"),
    exit: actionSignatures(config.exit, "exit"),
    invoke: asArray(config.invoke),
    onDone: asArray(config.onDone),
    tags: strings(config.tags),
    meta: config.meta,
    output: config.output,
    description: str(config.description),
    types: config.types,
  }) as StateMachineXState;

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    warnings,
    ir: omitUndefined({
      kind: "state" as const,
      states,
      transitions,
      notes: [],
      xstate: Object.keys(machine).length > 0 ? machine : undefined,
    }) as StateIR,
  };
}
