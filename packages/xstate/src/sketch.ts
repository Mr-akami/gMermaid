import type { StateIR, XValue } from "@gmermaid/ir";
import type { ParseError, ParseWarning } from "@gmermaid/mermaid-parser";
import { Parser } from "acorn";
import { tsPlugin } from "@sveltejs/acorn-typescript";
import { parseXStateMachine } from "./toIR";
import type { XObject } from "./read";

// A machine as people actually write it — TypeScript, transitions that are
// functions returning `{ target, context }`, actors made by `createAsyncLogic`
// — drawn as a diagram. READ-ONLY: this is a picture of the code, never a
// projection of it (ADR 0002 keeps the XState tab to plain data, because
// that tab writes back). Nothing here is run; acorn reads the source.
//
// What it keeps: the state tree, `initial`, `type`, `id`, event / `always` /
// `after` transitions, and an `invoke`'s `onDone` / `onError` (drawn as
// `done: <src>` / `error: <src>` arrows). A transition FUNCTION is read for
// the `target` of every object it returns. Everything else (actions,
// context, input, schemas, guards' code) is code, and is not drawn.

export interface SketchedMachine {
  /** The `const` it is bound to, else its `id`, else `machine`. */
  readonly name: string;
  readonly ir: StateIR;
  /** What the picture leaves out or had to guess. */
  readonly warnings: readonly ParseWarning[];
}

export type SketchResult =
  | { readonly ok: true; readonly machines: readonly SketchedMachine[] }
  | { readonly ok: false; readonly errors: readonly ParseError[] };

// acorn + the TS plugin give ESTree nodes; only a few fields are touched.
interface N {
  readonly type: string;
  readonly loc?: { readonly start: { readonly line: number } } | null;
  readonly [key: string]: unknown;
}

const TSParser = Parser.extend(tsPlugin() as never);

const lineOf = (n: N): number => n.loc?.start.line ?? 1;

/** Look through `x as T`, `x satisfies T`, `x!` and parentheses. */
function bare(n: N): N {
  let cur = n;
  while (["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "ParenthesizedExpression", "TSTypeAssertion"].includes(cur.type)) {
    cur = cur.expression as N;
  }
  return cur;
}

function str(n: N | undefined): string | undefined {
  if (n === undefined) return undefined;
  const b = bare(n);
  if (b.type === "Literal" && (typeof b.value === "string" || typeof b.value === "number")) return String(b.value);
  if (b.type === "TemplateLiteral" && (b.expressions as N[]).length === 0) {
    return ((b.quasis as N[])[0]?.value as { cooked?: string } | undefined)?.cooked;
  }
  return undefined;
}

function keyOf(p: N): string | undefined {
  if (p.computed === true) return undefined;
  const k = p.key as N;
  if (k.type === "Identifier") return k.name as string;
  return str(k);
}

/** The init properties of an object literal, by key. */
function props(n: N | undefined): Map<string, N> {
  const out = new Map<string, N>();
  if (n === undefined) return out;
  const b = bare(n);
  if (b.type !== "ObjectExpression") return out;
  for (const p of b.properties as N[]) {
    if (p.type !== "Property") continue;
    const k = keyOf(p);
    if (k !== undefined) out.set(k, p.value as N);
  }
  return out;
}

const isFunction = (n: N): boolean => ["ArrowFunctionExpression", "FunctionExpression"].includes(bare(n).type);

/** Every expression a function hands back: the arrow's expression body, or
 * each `return x` of its block (not those of functions nested inside). */
function returnedBy(fn: N): N[] {
  const f = bare(fn);
  const body = f.body as N;
  if (body.type !== "BlockStatement") return [body];
  const out: N[] = [];
  const visit = (n: unknown): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(visit);
    const node = n as N;
    if (typeof node.type !== "string") return;
    if (isFunction(node) || node.type === "FunctionDeclaration") return;
    if (node.type === "ReturnStatement") {
      if (node.argument !== null && node.argument !== undefined) out.push(node.argument as N);
      return;
    }
    for (const [k, v] of Object.entries(node)) if (k !== "loc") visit(v);
  };
  visit(body.body);
  return out;
}

/** One drawable outcome of an expression a transition evaluates to. */
function outcomes(n: N): N[] {
  const b = bare(n);
  if (b.type === "ConditionalExpression") return [...outcomes(b.consequent as N), ...outcomes(b.alternate as N)];
  if (b.type === "LogicalExpression") return [...outcomes(b.left as N), ...outcomes(b.right as N)];
  return [b];
}

export function sketchXStateSource(code: string): SketchResult {
  let program: N;
  try {
    program = TSParser.parse(code, { ecmaVersion: "latest", sourceType: "module", locations: true }) as unknown as N;
  } catch (e) {
    const err = e as { message?: string; loc?: { line?: number } };
    return { ok: false, errors: [{ line: err.loc?.line ?? 1, message: err.message ?? "cannot parse as TypeScript" }] };
  }

  // every `createMachine({ … })` / `….createMachine({ … })`, with the name it is bound to
  const found: { config: N; binding?: string }[] = [];
  const visit = (n: unknown, binding: string | undefined): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach((c) => visit(c, binding));
    const node = n as N;
    if (typeof node.type !== "string") return;
    let bind = binding;
    if (node.type === "VariableDeclarator" && (node.id as N).type === "Identifier") bind = (node.id as N).name as string;
    if (node.type === "CallExpression") {
      const callee = node.callee as N;
      const named =
        (callee.type === "Identifier" && callee.name === "createMachine") ||
        (callee.type === "MemberExpression" && (callee.property as N).type === "Identifier" && (callee.property as N).name === "createMachine");
      const arg = (node.arguments as N[])[0];
      if (named && arg !== undefined && bare(arg).type === "ObjectExpression") {
        found.push({ config: bare(arg), ...(bind !== undefined ? { binding: bind } : {}) });
        return;
      }
    }
    for (const [k, v] of Object.entries(node)) if (k !== "loc") visit(v, bind);
  };
  visit(program, undefined);
  if (found.length === 0) return { ok: false, errors: [{ line: 1, message: "no `createMachine({ … })` found" }] };

  const machines: SketchedMachine[] = [];
  for (const { config, binding } of found) {
    const warnings: ParseWarning[] = [];
    const warn = (n: N, message: string): void => void warnings.push({ line: lineOf(n), message });

    /** A transition value → plain `{ target?, guard? }` data, one per outcome. */
    const transitions = (v: N, where: string): XObject[] => {
      const b = bare(v);
      const target = str(b);
      if (target !== undefined) return [{ target }];
      if (b.type === "ArrayExpression") return (b.elements as (N | null)[]).flatMap((e) => (e === null ? [] : transitions(e, where)));
      if (b.type === "ObjectExpression") {
        const p = props(b);
        const out: Record<string, XValue> = {};
        const t = p.get("target");
        const ts = t === undefined ? undefined : str(t) ?? (bare(t).type === "ArrayExpression" ? str((bare(t).elements as N[])[0]) : undefined);
        if (ts !== undefined) out.target = ts;
        else if (t !== undefined) warn(t, `${where}: a computed target is not drawn`);
        const g = p.get("guard");
        if (g !== undefined) out.guard = str(g) ?? "ƒ";
        if (ts === undefined) out.actions = "…"; // no target: runs code in place
        return [out];
      }
      if (isFunction(b)) {
        const results = returnedBy(b).flatMap(outcomes);
        const drawn: XObject[] = [];
        let inPlace = results.length === 0;
        for (const r of results) {
          const t = r.type === "ObjectExpression" ? props(r).get("target") : undefined;
          const ts = t === undefined ? undefined : str(t);
          if (ts === undefined) inPlace = true;
          else if (!drawn.some((d) => d.target === ts)) drawn.push({ target: ts });
        }
        if (inPlace) drawn.push({ actions: "…" });
        // several outcomes are picked by code: mark them as guarded
        return drawn.length > 1 ? drawn.map((d) => ({ ...d, guard: "ƒ" })) : drawn;
      }
      warn(b, `${where}: a transition written as \`${b.type}\` is not drawn`);
      return [];
    };

    const pushOn = (on: Record<string, XValue[]>, event: string, list: XObject[]): void => {
      if (list.length > 0) on[event] = [...(on[event] ?? []), ...list];
    };

    const state = (n: N, path: string, isRoot: boolean): XObject => {
      const p = props(n);
      const out: Record<string, XValue> = {};
      for (const k of ["type", "initial", "id", "history", "description"] as const) {
        const s = p.get(k) === undefined ? undefined : str(p.get(k));
        if (s !== undefined) out[k] = s;
      }
      if (out.type === "history" && p.get("target") !== undefined) {
        const s = str(p.get("target"));
        if (s !== undefined) out.target = s;
      }
      const on: Record<string, XValue[]> = {};
      const onNode = p.get("on");
      for (const [event, v] of props(onNode)) pushOn(on, event, transitions(v, `${path}.on.${event}`));
      const always = p.get("always") === undefined ? [] : transitions(p.get("always")!, `${path}.always`);
      const after: Record<string, XValue> = {};
      for (const [delay, v] of props(p.get("after"))) {
        const list = transitions(v, `${path}.after.${delay}`);
        if (list.length > 0) after[delay] = list;
      }
      const inv = p.get("invoke");
      const invokes = inv === undefined ? [] : bare(inv).type === "ArrayExpression" ? ((bare(inv).elements as (N | null)[]).filter((x) => x !== null) as N[]) : [inv];
      for (const i of invokes) {
        const ip = props(i);
        const srcNode = ip.get("src");
        const src = str(srcNode) ?? str(ip.get("id")) ?? (srcNode !== undefined && bare(srcNode).type === "Identifier" ? (bare(srcNode).name as string) : "actor");
        if (ip.get("onDone") !== undefined) pushOn(on, `done: ${src}`, transitions(ip.get("onDone")!, `${path}.invoke.onDone`));
        if (ip.get("onError") !== undefined) pushOn(on, `error: ${src}`, transitions(ip.get("onError")!, `${path}.invoke.onError`));
      }
      if (p.get("onDone") !== undefined) pushOn(on, "done", transitions(p.get("onDone")!, `${path}.onDone`));

      if (isRoot) {
        if (Object.keys(on).length > 0 || always.length > 0 || Object.keys(after).length > 0) {
          warn(onNode ?? n, "transitions on the machine itself are not drawn — there is no state box to draw them from");
        }
      } else {
        if (always.length > 0) out.always = always;
        if (Object.keys(after).length > 0) out.after = after;
        if (Object.keys(on).length > 0) out.on = on;
      }
      const children = props(p.get("states"));
      if (children.size > 0) {
        const states: Record<string, XValue> = {};
        for (const [k, v] of children) states[k] = state(v, `${path === "" ? "" : `${path}.`}states.${k}`, false);
        out.states = states;
      }
      return out;
    };

    const data = state(config, "", true);
    const parsed = parseXStateMachine(`createMachine(${JSON.stringify(data)})`);
    if (!parsed.ok) {
      return { ok: false, errors: parsed.errors.map((e) => ({ line: lineOf(config), message: e.message })) };
    }
    const name = binding ?? (typeof data.id === "string" ? data.id : "machine");
    warnings.push({ line: lineOf(config), message: "read-only picture: actions, context, input and guard code are not drawn; `ƒ` marks a choice made by code" });
    machines.push({ name, ir: stripDetail(parsed.ir), warnings: [...warnings, ...parsed.warnings] });
  }
  return { ok: true, machines };
}

/** The picture carries no XState detail: it is never projected back. */
function stripDetail(ir: StateIR): StateIR {
  const { xstate: _m, ...rest } = ir;
  return {
    ...rest,
    states: ir.states.map(({ xstate: _x, ...s }) => s),
    transitions: ir.transitions.map(({ xstate: _x, ...t }) => t),
  };
}
