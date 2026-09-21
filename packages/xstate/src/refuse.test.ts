import { describe, expect, it } from "vitest";
import { parseXStateMachine } from "./toIR";

// A machine we cannot represent must say so, in words that name the thing it
// found and the supported spelling. Silence here is the failure mode this
// whole projection exists to avoid.

function errorsOf(code: string): string[] {
  const r = parseXStateMachine(code);
  expect(r.ok, `expected a refusal:\n${code}`).toBe(false);
  return r.ok ? [] : r.errors.map((e) => e.message);
}

describe("the accepted XState subset", () => {
  it("refuses inline functions and points at setup()", () => {
    expect(errorsOf(`createMachine({ initial: "a", states: { a: { entry: () => {} } } })`)[0]).toMatch(
      /inline function is not supported.*setup/,
    );
  });

  it("refuses calls in the config", () => {
    expect(errorsOf(`createMachine({ initial: "a", states: { a: { on: { GO: { guard: and(["x", "y"]) } } } } })`)[0]).toMatch(
      /a call \(`and\( … \)`\) is not supported/,
    );
  });

  it("refuses a bare identifier reference", () => {
    expect(errorsOf(`createMachine({ initial: "a", states: { a: { entry: doThing } } })`)[0]).toMatch(
      /`doThing` is a reference to code/,
    );
  });

  it("names the v4 spelling it found", () => {
    expect(errorsOf(`createMachine({ initial: "a", states: { a: { on: { GO: { cond: "ok", target: "a" } } } } })`)[0]).toBe(
      "states.a.on.GO: `cond` is XState v4 — v5 spells it `guard`",
    );
    expect(errorsOf(`Machine({ initial: "a", states: { a: {} } })`)[0]).toBe(
      "`Machine()` is XState v4 — v5 spells it `createMachine()`",
    );
    expect(errorsOf(`createMachine({ initial: "a", states: { a: { onEntry: "x" } } })`)[0]).toMatch(/onEntry/);
  });

  it("refuses an unknown key rather than dropping it", () => {
    expect(errorsOf(`createMachine({ initial: "a", states: { a: { onEnter: "x" } } })`)[0]).toBe(
      "states.a.onEnter: unknown key `onEnter`",
    );
  });

  it("refuses a target that resolves to nothing", () => {
    expect(errorsOf(`createMachine({ initial: "a", states: { a: { on: { GO: "nowhere" } } } })`)[0]).toBe(
      "states.a.on.GO: unknown target `nowhere`",
    );
    expect(errorsOf(`createMachine({ initial: "a", states: { a: { on: { GO: "#ghost" } } } })`)[0]).toMatch(
      /no state carries `id: "ghost"`/,
    );
  });

  it("refuses a parallel machine root, because mermaid has nowhere to draw it", () => {
    expect(errorsOf(`createMachine({ type: "parallel", states: { a: {}, b: {} } })`)[0]).toMatch(
      /parallel machine root is not supported/,
    );
  });

  it("refuses transitions on the machine root", () => {
    expect(errorsOf(`createMachine({ initial: "a", states: { a: {} }, on: { GO: "a" } })`)[0]).toMatch(
      /transitions on the machine root are not supported/,
    );
  });

  it("refuses text that holds no machine at all", () => {
    expect(errorsOf(`const x = 1;`)[0]).toMatch(/no machine found/);
  });

  it("reports the line the problem is on", () => {
    const r = parseXStateMachine(`createMachine({\n  initial: "a",\n  states: {\n    a: { entry: () => {} },\n  },\n})`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.line).toBe(4);
  });

  it("warns — but does not refuse — a compound state with no initial", () => {
    const r = parseXStateMachine(`createMachine({ initial: "a", states: { a: { states: { b: {} } } } })`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings[0]?.message).toMatch(/no `initial`/);
  });

  it("takes comments and trailing commas in its stride", () => {
    const r = parseXStateMachine(`createMachine({
      // the light starts green
      initial: "green",
      states: { green: {}, },
    })`);
    expect(r.ok).toBe(true);
  });
});
