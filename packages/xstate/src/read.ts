import type { XValue } from "@gmermaid/ir";
import type { ParseError } from "@gmermaid/mermaid-parser";
import { parse as acornParse, parseExpressionAt } from "acorn";
import type { Node } from "acorn";

// An XState machine is JavaScript, not data. We NEVER run it: acorn gives us
// an abstract syntax tree without executing a single line, and this module
// turns the subset we accept into plain values. Everything else is refused
// with a message that names what it found and what is supported instead — a
// machine that silently loses its actions would be worse than one that will
// not open.
//
// Accepted:
//   • `createMachine({ … })`, `setup({ … }).createMachine({ … })`, or a bare
//     `{ … }` object literal. `import` statements and a `const`/`export`
//     binding around the call are ignored.
//   • Inside the config: object and array literals, strings, numbers,
//     booleans, `null`, negative numbers, template literals with no `${}`.
//     Trailing commas and comments are fine (acorn eats them).
//   • `context:` and the argument of `setup({ … })` are NOT read — they hold
//     functions by design. Their source text is carried through verbatim.
//
// Refused (with the reason): arrow functions and `function` bodies, calls,
// identifier references, spreads, computed keys, `new`, and XState v4 spelling.

export interface ReadResult {
  /** The machine config, as literal data. */
  readonly config: XObject;
  /** Verbatim source of the `setup({ … })` argument, when there was one. */
  readonly setup?: string;
  /** Verbatim source of `context:`, when there was one. */
  readonly context?: string;
  /** Source line of every property, by dotted path (`states.idle.on.GO`), so
   * the errors this module cannot raise — an unknown target, a `type` we do
   * not know — still point at a line in the user's text. */
  readonly lines: Readonly<Record<string, number>>;
}

export type XObject = { readonly [key: string]: XValue };

/** Where a refusal happened, in the user's text. */
export class ReadError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(message);
  }
}

// acorn's types are structural; we only ever touch a handful of fields.
interface AnyNode extends Omit<Node, "loc"> {
  readonly type: string;
  readonly loc?: { readonly start: { readonly line: number } } | null | undefined;
  readonly [key: string]: unknown;
}

const lineOf = (n: AnyNode): number => n.loc?.start.line ?? 1;

/** XState v4 spellings, and the v5 replacement to point at. */
const V4_KEYS: Record<string, string> = {
  cond: "`cond` is XState v4 — v5 spells it `guard`",
  onEntry: "`onEntry` is XState v4 — v5 spells it `entry`",
  onExit: "`onExit` is XState v4 — v5 spells it `exit`",
  services: "`services` is XState v4 — v5 registers actors in `setup({ actors })`",
  activities: "`activities` was removed in XState v5",
  internal: "`internal` is XState v4 — v5 spells it `reenter` (with the opposite sense)",
  strict: "`strict` was removed in XState v5 — use a `\"*\"` event instead",
  schema: "`schema` is XState v4 — v5 spells it `types`",
  tsTypes: "`tsTypes` is XState v4 — v5 spells it `types`",
};

function refuse(node: AnyNode, path: string, what: string): never {
  throw new ReadError(lineOf(node), `${path === "" ? "" : `${path}: `}${what}`);
}

/** The name of a property key, or a refusal for computed / exotic keys. */
function keyName(prop: AnyNode, path: string): string {
  if (prop.computed === true) refuse(prop, path, "a computed key `[ … ]` is not supported — write the key literally");
  const key = prop.key as AnyNode;
  if (key.type === "Identifier") return key.name as string;
  if (key.type === "Literal") {
    const v = key.value;
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
  }
  return refuse(key, path, "only plain and quoted keys are supported");
}

/** The subset of JavaScript expressions that is data. */
function literal(node: AnyNode, path: string, lines: Record<string, number>): XValue {
  switch (node.type) {
    case "Literal": {
      const v = node.value;
      if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
      return refuse(node, path, "regular expressions and bigints are not supported");
    }
    case "TemplateLiteral": {
      const exprs = node.expressions as AnyNode[];
      if (exprs.length > 0) refuse(node, path, "a template with `${ … }` is not supported — write a plain string");
      const quasis = node.quasis as AnyNode[];
      return ((quasis[0]?.value as { cooked?: string } | undefined)?.cooked ?? "") as XValue;
    }
    case "UnaryExpression": {
      if (node.operator === "-" || node.operator === "+") {
        const arg = literal(node.argument as AnyNode, path, lines);
        if (typeof arg === "number") return node.operator === "-" ? -arg : arg;
      }
      return refuse(node, path, `\`${String(node.operator)}\` is not supported in a machine config`);
    }
    case "ArrayExpression": {
      const out: XValue[] = [];
      (node.elements as (AnyNode | null)[]).forEach((el, i) => {
        if (el === null) refuse(node, path, "array holes are not supported");
        if (el.type === "SpreadElement") refuse(el, path, "`...` spread is not supported");
        const at = `${path}[${i}]`;
        lines[at] = lineOf(el);
        out.push(literal(el, at, lines));
      });
      return out;
    }
    case "ObjectExpression":
      return objectLiteral(node, path, lines);
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return refuse(
        node,
        path,
        "an inline function is not supported — name it in `setup({ actions, guards, delays })` and reference it by name",
      );
    case "CallExpression":
      return refuse(
        node,
        path,
        `a call (\`${sourceName(node.callee as AnyNode)}( … )\`) is not supported — the config must be plain data; put implementations in \`setup({ … })\``,
      );
    case "Identifier":
      return refuse(
        node,
        path,
        `\`${String(node.name)}\` is a reference to code — name the action or guard in \`setup({ … })\` and reference it as a string`,
      );
    case "MemberExpression":
      return refuse(node, path, "a property reference is not supported — the config must be plain data");
    case "NewExpression":
      return refuse(node, path, "`new` is not supported — the config must be plain data");
    default:
      return refuse(node, path, `\`${node.type}\` is not supported in a machine config`);
  }
}

function sourceName(callee: AnyNode): string {
  if (callee.type === "Identifier") return String(callee.name);
  if (callee.type === "MemberExpression") return `${sourceName(callee.object as AnyNode)}.${sourceName(callee.property as AnyNode)}`;
  return "…";
}

function objectLiteral(node: AnyNode, path: string, lines: Record<string, number>): XObject {
  const out: Record<string, XValue> = {};
  for (const prop of node.properties as AnyNode[]) {
    if (prop.type === "SpreadElement") refuse(prop, path, "`...` spread is not supported");
    if (prop.kind !== "init" || prop.method === true) refuse(prop, path, "getters, setters and methods are not supported");
    const name = keyName(prop, path);
    const v4 = V4_KEYS[name];
    if (v4 !== undefined) refuse(prop, path, v4);
    const at = path === "" ? name : `${path}.${name}`;
    lines[at] = lineOf(prop);
    out[name] = literal(prop.value as AnyNode, at, lines);
  }
  return out;
}

/** Strip the `context:` property out of an object expression, returning its
 * verbatim source. Context is often a factory function; it is carried, not
 * read. Same for the machine `id` when it is not a literal. */
function takeRaw(node: AnyNode, code: string, key: string): { rest: AnyNode; raw?: string } {
  const props = node.properties as AnyNode[];
  const hit = props.find((p) => p.type === "Property" && p.kind === "init" && p.computed !== true && keyName(p, "") === key);
  if (hit === undefined) return { rest: node };
  const value = hit.value as AnyNode;
  const raw = code.slice(value.start, value.end);
  const rest = { ...node, properties: props.filter((p) => p !== hit) } as unknown as AnyNode;
  return { rest, raw };
}

/** Find `createMachine(config)` / `setup(s).createMachine(config)` anywhere in
 * the program, ignoring imports and the binding it is assigned to. */
function findMachineCall(program: AnyNode): { call: AnyNode; setupArg?: AnyNode } | undefined {
  let found: { call: AnyNode; setupArg?: AnyNode } | undefined;
  const visit = (n: unknown): void => {
    if (found !== undefined || n === null || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const c of n) visit(c);
      return;
    }
    const node = n as AnyNode;
    if (typeof node.type !== "string") return;
    if (node.type === "CallExpression") {
      const callee = node.callee as AnyNode;
      if (callee.type === "Identifier" && callee.name === "Machine") {
        throw new ReadError(lineOf(node), "`Machine()` is XState v4 — v5 spells it `createMachine()`");
      }
      if (callee.type === "Identifier" && callee.name === "createMachine") {
        found = { call: node };
        return;
      }
      if (callee.type === "MemberExpression") {
        const prop = callee.property as AnyNode;
        const obj = callee.object as AnyNode;
        if (prop.type === "Identifier" && prop.name === "createMachine") {
          const setupArg =
            obj.type === "CallExpression" && (obj.callee as AnyNode).name === "setup"
              ? ((obj.arguments as AnyNode[])[0] ?? undefined)
              : undefined;
          found = { call: node, ...(setupArg !== undefined ? { setupArg } : {}) };
          return;
        }
      }
    }
    for (const value of Object.values(node)) visit(value);
  };
  visit(program);
  return found;
}

/** Read XState source text into literal data. Throws ReadError on refusal. */
function readOrThrow(code: string): ReadResult {
  let program: AnyNode;
  try {
    program = acornParse(code, { ecmaVersion: 2023, sourceType: "module", locations: true }) as unknown as AnyNode;
  } catch (e) {
    // a bare `{ … }` object literal is a block statement to a JS parser —
    // retry it as an expression before reporting a syntax error
    const expr = tryExpression(code);
    if (expr !== undefined) return fromConfigNode(expr.node, expr.source, undefined);
    const err = e as { message?: string; loc?: { line?: number } };
    throw new ReadError(err.loc?.line ?? 1, err.message ?? "cannot parse as JavaScript");
  }

  const machine = findMachineCall(program);
  if (machine === undefined) {
    const expr = tryExpression(code);
    if (expr !== undefined) return fromConfigNode(expr.node, expr.source, undefined);
    throw new ReadError(
      1,
      "no machine found — write `createMachine({ … })`, `setup({ … }).createMachine({ … })`, or a bare `{ … }` config object",
    );
  }
  const args = machine.call.arguments as AnyNode[];
  const config = args[0];
  if (config === undefined) throw new ReadError(lineOf(machine.call), "`createMachine()` needs a config object");
  if (config.type !== "ObjectExpression") {
    throw new ReadError(lineOf(config), "`createMachine()` must be given an object literal, not a reference");
  }
  const setupArg = machine.setupArg;
  if (setupArg !== undefined && setupArg.type !== "ObjectExpression") {
    throw new ReadError(lineOf(setupArg), "`setup()` must be given an object literal");
  }
  return fromConfigNode(config, code, setupArg === undefined ? undefined : code.slice(setupArg.start, setupArg.end));
}

/** A bare `{ … }` config reads as a block statement to a JS parser, so it is
 * re-parsed inside parentheses; the offsets then belong to THAT text, which is
 * why it travels back with the node. */
function tryExpression(code: string): { node: AnyNode; source: string } | undefined {
  const source = `(${code.trim()})`;
  try {
    const node = parseExpressionAt(source, 0, { ecmaVersion: 2023, sourceType: "module", locations: true }) as unknown as AnyNode;
    return node.type === "ObjectExpression" ? { node, source } : undefined;
  } catch {
    return undefined;
  }
}

function fromConfigNode(config: AnyNode, source: string, setup: string | undefined): ReadResult {
  const { rest, raw } = takeRaw(config, source, "context");
  const lines: Record<string, number> = {};
  return {
    config: objectLiteral(rest, "", lines),
    ...(setup !== undefined ? { setup } : {}),
    ...(raw !== undefined ? { context: raw } : {}),
    lines,
  };
}

export function readMachineSource(code: string): { ok: true; value: ReadResult } | { ok: false; errors: readonly ParseError[] } {
  try {
    return { ok: true, value: readOrThrow(code) };
  } catch (e) {
    if (e instanceof ReadError) return { ok: false, errors: [{ line: e.line, message: e.message }] };
    throw e;
  }
}
