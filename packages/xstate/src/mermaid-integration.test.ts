// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import mermaid from "mermaid";
import { stateToMermaid } from "@gmermaid/mermaid-codegen";
import { parseXStateMachine } from "./toIR";

// The XState reader mints state ids of its own (from machine keys, which may
// be anything JavaScript allows), so the mermaid text it feeds the canvas has
// to be checked against the REAL mermaid.js parser — the same discipline
// `mermaid-codegen` keeps for every other kind.

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false });
});

async function mermaidAccepts(machine: string): Promise<void> {
  const parsed = parseXStateMachine(machine);
  if (!parsed.ok) throw new Error(parsed.errors.map((e) => `line ${e.line}: ${e.message}`).join("\n"));
  const code = stateToMermaid(parsed.ir);
  await expect(mermaid.parse(code), code).resolves.toBeTruthy();
}

describe("mermaid.js accepts the diagram an XState machine becomes", () => {
  it("nested states, finals, guards and delays", async () => {
    await mermaidAccepts(`createMachine({
      initial: "idle",
      states: {
        idle: { entry: "reset", on: { FETCH: { target: "loading", actions: "log" } } },
        loading: {
          after: { 2000: "idle" },
          on: { RESOLVE: "done", REJECT: [{ guard: "canRetry", target: "loading" }, { target: "failed" }] },
        },
        failed: { on: { RETRY: "loading" } },
        done: { type: "final" },
      },
    })`);
  });

  it("parallel regions", async () => {
    await mermaidAccepts(`createMachine({
      initial: "editing",
      states: {
        editing: {
          type: "parallel",
          states: {
            bold: { initial: "off", states: { off: { on: { TOGGLE: "on" } }, on: { on: { TOGGLE: "off" } } } },
            italic: { initial: "off", states: { off: { on: { TOGGLE: "on" } }, on: { on: { TOGGLE: "off" } } } },
          },
        },
      },
    })`);
  });

  it("machine keys mermaid's grammar would choke on", async () => {
    // `note` and `class` are keywords in mermaid's state grammar, `a-b` and
    // `2nd` are not spellable ids at all
    await mermaidAccepts(`createMachine({
      initial: "note",
      states: {
        note: { on: { "user.updated": "2nd" } },
        "2nd": { on: { GO: "a-b" } },
        "a-b": { on: { "*": "class" } },
        class: {},
      },
    })`);
  });

  it("labels carrying params, which travel through mermaid entities", async () => {
    await mermaidAccepts(`createMachine({
      initial: "a",
      states: {
        a: { on: { GO: { target: "b", guard: { type: "atLeast", params: { min: 3 } }, actions: "log" } } },
        b: {},
      },
    })`);
  });
});
