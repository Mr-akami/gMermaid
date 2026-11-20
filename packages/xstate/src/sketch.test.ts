import { describe, expect, it } from "vitest";
import { stateToMermaid } from "@gmermaid/mermaid-codegen";
import { sketchXStateSource } from "./sketch";

// A machine as written in an app: TypeScript, actors made by functions,
// transitions that are functions returning `{ target, context }`.
const SOURCE = `
import { createAsyncLogic, setup, types } from "xstate";
type Ctx = { error: string | null };
const messageOf = (e: unknown): string => String(e);

export const jobMachine = setup({
  schemas: { context: types<Ctx>() },
  actors: { run: createAsyncLogic({ run: async () => 1 }) },
}).createMachine({
  id: "job",
  context: { error: null } as Ctx,
  initial: "idle",
  on: { RESET: { target: ".idle" } },
  states: {
    idle: { on: { START: { target: "running" }, PING: () => ({}) } },
    running: {
      invoke: {
        src: "run",
        input: ({ context }) => context,
        onDone: { target: "done" },
        onError: ({ event }) => ({ target: "failed", context: { error: messageOf(event.error) } }),
      },
      on: {
        TICK: ({ context }) => (context.error === null ? { target: "running" } : { target: "failed" }),
        STOP: (_, enq) => {
          enq(() => console.log("stop"));
          return { target: "idle" };
        },
      },
      after: { 5000: "failed" },
    },
    failed: { on: { RETRY: { target: "running", guard: ({ context }) => context.error !== null } } },
    done: { type: "final" },
  },
});
`;

describe("sketchXStateSource: a picture of a machine written as code", () => {
  const r = sketchXStateSource(SOURCE);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const [m] = r.machines;
  const mermaid = stateToMermaid(m!.ir);

  it("reads TypeScript and names the machine by its binding", () => {
    expect(r.machines).toHaveLength(1);
    expect(m!.name).toBe("jobMachine");
  });

  it("draws object, string and function transitions by their target", () => {
    expect(mermaid).toContain("idle --> running : START");
    expect(mermaid).toContain("running --> idle : STOP");
    expect(mermaid).toContain("running --> failed : after 5000ms");
  });

  it("draws an invoke's onDone / onError as arrows named after the actor", () => {
    expect(mermaid).toContain("running --> done : done: run");
    expect(mermaid).toContain("running --> failed : error: run");
  });

  it("marks outcomes picked by code, and code-only guards, with ƒ", () => {
    expect(mermaid).toContain("running --> running : TICK [ƒ]");
    expect(mermaid).toContain("running --> failed : TICK [ƒ]");
    expect(mermaid).toContain("failed --> running : RETRY [ƒ]");
  });

  it("draws a transition with no target as running code in place", () => {
    expect(mermaid).toContain("idle --> idle : PING / …");
  });

  it("says what it leaves out", () => {
    const text = m!.warnings.map((w) => w.message).join("\n");
    expect(text).toMatch(/transitions on the machine itself are not drawn/);
    expect(text).toMatch(/read-only picture/);
  });

  it("carries no XState detail — the picture is never projected back", () => {
    expect(m!.ir.xstate).toBeUndefined();
    expect(m!.ir.states.every((s) => s.xstate === undefined)).toBe(true);
  });

  it("finds every machine in a file", () => {
    const two = sketchXStateSource(`const a = createMachine({ initial: "x", states: { x: {} } });\nconst b = createMachine({ id: "bee", initial: "y", states: { y: {} } });`);
    expect(two.ok && two.machines.map((x) => x.name)).toEqual(["a", "b"]);
  });

  it("refuses source with no machine, and source that is not TypeScript", () => {
    expect(sketchXStateSource("const x = 1;").ok).toBe(false);
    const broken = sketchXStateSource("createMachine({ states: { ");
    expect(broken.ok).toBe(false);
  });
});
