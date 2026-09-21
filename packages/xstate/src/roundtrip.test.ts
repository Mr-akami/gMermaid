import { describe, expect, it } from "vitest";
import { createMachine, setup } from "xstate";
import type { StateIR } from "@gmermaid/ir";
import { parseXStateMachine } from "./toIR";
import { stateToXState } from "./fromIR";

// The two halves of the XState projection are inverses of each other, and the
// text we emit is a machine the REAL xstate accepts. Both are asserted for
// every sample — a config only we can read would be worthless.

function parseOk(code: string): StateIR {
  const r = parseXStateMachine(code);
  if (!r.ok) throw new Error(r.errors.map((e) => `line ${e.line}: ${e.message}`).join("\n"));
  return r.ir;
}

/** Run the emitted module and hand the config to the real `createMachine`.
 * This evaluates OUR OWN generated text inside the test — never user input,
 * which the reader refuses to execute by design. */
function realMachine(code: string): unknown {
  const body = code
    .split("\n")
    .filter((l) => !l.startsWith("import "))
    .join("\n")
    .replace("export const machine =", "return");
  // eslint-disable-next-line no-new-func
  const fn = new Function("setup", "createMachine", body) as (s: typeof setup, c: typeof createMachine) => unknown;
  return fn(setup, createMachine);
}

/** parse → codegen → parse is the identity on the IR, and the text is a
 * machine xstate accepts. */
function expectRoundTrip(source: string): StateIR {
  const ir = parseOk(source);
  const out = stateToXState(ir);
  expect(() => realMachine(out.code), out.code).not.toThrow();
  expect(parseOk(out.code), out.code).toEqual(ir);
  return ir;
}

describe("XState v5 round trip", () => {
  it("nested states, initial, string and object targets", () => {
    const ir = expectRoundTrip(`
      createMachine({
        id: "traffic",
        initial: "green",
        states: {
          green: { on: { TIMER: "yellow" } },
          yellow: { on: { TIMER: { target: "red", actions: "warn" } } },
          red: {
            initial: "walk",
            states: { walk: { on: { COUNTDOWN: "wait" } }, wait: {} },
            on: { TIMER: "green" },
          },
        },
      })
    `);
    expect(ir.states.map((s) => s.id)).toEqual(["state_start", "green", "yellow", "red", "state_start_red", "walk", "wait"]);
    expect(ir.transitions.find((t) => t.from === ("yellow" as never))?.label).toBe("TIMER / warn");
  });

  it("multiple guarded transitions for one event keep their order", () => {
    const ir = expectRoundTrip(`
      createMachine({
        initial: "a",
        states: {
          a: {
            on: {
              GO: [
                { guard: "isReady", target: "b" },
                { guard: { type: "hasQuota", params: { max: 3 } }, target: "c" },
                { target: "a" },
              ],
            },
          },
          b: {},
          c: {},
        },
      })
    `);
    expect(ir.transitions.filter((t) => t.from === ("a" as never)).map((t) => t.label)).toEqual([
      "GO [isReady]",
      'GO [hasQuota({"max":3})]',
      "GO",
    ]);
  });

  it("always, after (numeric and named delays) and internal transitions", () => {
    const ir = expectRoundTrip(`
      setup({ delays: { timeout: 500 } }).createMachine({
        initial: "loading",
        states: {
          loading: {
            always: { guard: "isDone", target: "ready" },
            after: { 1000: "slow", timeout: { target: "ready", actions: "note" } },
            on: { PING: { actions: "count" } },
          },
          slow: {},
          ready: {},
        },
      })
    `);
    const labels = ir.transitions.map((t) => t.label);
    expect(labels).toContain("[isDone]");
    expect(labels).toContain("after 1000ms");
    expect(labels).toContain("after timeout / note");
    const internal = ir.transitions.find((t) => t.label === "PING / count")!;
    expect(internal.from).toBe(internal.to);
    expect(internal.xstate?.internal).toBe(true);
  });

  it("entry/exit actions with params, tags, meta and description", () => {
    const ir = expectRoundTrip(`
      createMachine({
        initial: "idle",
        states: {
          idle: {
            description: "waiting for work",
            entry: ["resetCount", { type: "track", params: { name: "idle" } }],
            exit: "flush",
            tags: ["cold"],
            meta: { color: "blue" },
            on: { WORK: "busy" },
          },
          busy: {},
        },
      })
    `);
    const idle = ir.states.find((s) => s.id === ("idle" as never))!;
    expect(idle.label).toBe("waiting for work");
    expect(idle.xstate?.entry).toEqual(["resetCount", 'track({"name":"idle"})']);
    expect(idle.xstate?.exit).toEqual(["flush"]);
  });

  it("type: final becomes the region's [*], a second final stays a box", () => {
    const ir = expectRoundTrip(`
      createMachine({
        initial: "work",
        states: {
          work: { on: { DONE: "done", CANCEL: "cancelled" } },
          done: { type: "final", output: { ok: true } },
          cancelled: { type: "final" },
        },
      })
    `);
    const done = ir.states.find((s) => s.xstate?.key === "done")!;
    expect(done.role).toBe("end");
    expect(ir.states.find((s) => s.id === ("cancelled" as never))?.xstate?.final).toBe(true);
  });

  it("type: parallel becomes concurrency regions", () => {
    const ir = expectRoundTrip(`
      createMachine({
        initial: "active",
        states: {
          active: {
            type: "parallel",
            states: {
              bold: { initial: "off", states: { off: { on: { TOGGLE: "on" } }, on: { on: { TOGGLE: "off" } } } },
              underline: { initial: "off", states: { off: { on: { TOGGLE: "on" } }, on: { on: { TOGGLE: "off" } } } },
            },
          },
        },
      })
    `);
    const bold = ir.states.find((s) => s.id === ("bold" as never))!;
    const underline = ir.states.find((s) => s.id === ("underline" as never))!;
    expect(bold.parent).toBe("active");
    expect(bold.region).toBeUndefined();
    expect(underline.region).toBe(1);
  });

  it("type: history and #id targets", () => {
    const ir = expectRoundTrip(`
      createMachine({
        initial: "shell",
        states: {
          shell: {
            id: "root",
            initial: "one",
            states: {
              one: { on: { NEXT: "two" } },
              two: { on: { OUT: "#away" } },
              hist: { type: "history", history: "deep", target: "two" },
            },
          },
          away: { id: "away", on: { BACK: "#root.hist" } },
        },
      })
    `);
    expect(ir.states.find((s) => s.id === ("hist" as never))?.xstate).toMatchObject({ history: "deep", historyTarget: "two" });
    expect(ir.transitions.find((t) => t.label === "OUT")?.to).toBe("away");
    expect(ir.transitions.find((t) => t.label === "BACK")?.to).toBe("hist");
  });

  it("keys mermaid cannot spell keep their XState names", () => {
    const ir = expectRoundTrip(`createMachine({
      initial: "note",
      states: {
        note: { on: { "user.updated": "2nd" } },
        "2nd": { on: { GO: "a-b" } },
        "a-b": { on: { "*": "class" } },
        class: {},
      },
    })`);
    // mermaid ids are repaired; the machine keys survive beside them
    expect(ir.states.map((s) => s.id)).toEqual(["state_start", "stt_note", "stt_2nd", "a_b", "stt_class"]);
    expect(ir.states.map((s) => s.xstate?.key)).toEqual([undefined, "note", "2nd", "a-b", "class"]);
  });

  it("a bare object literal is accepted, and context/setup travel verbatim", () => {
    const ir = expectRoundTrip(`{
      context: { count: 0 },
      initial: "idle",
      states: { idle: {} },
    }`);
    expect(ir.xstate?.context).toBe("{ count: 0 }");
  });

  it("keeps a setup() block the reader never interprets", () => {
    const source = `setup({
  actions: { bump: assign({ n: ({ context }) => context.n + 1 }) },
}).createMachine({
  initial: "idle",
  states: { idle: { entry: "bump" } },
})`;
    const ir = parseOk(source);
    expect(ir.xstate?.setup).toContain("assign(");
    const out = stateToXState(ir);
    expect(out.code).toContain("import { setup, assign } from \"xstate\";");
    expect(parseOk(out.code)).toEqual(ir);
  });
});
