import { describe, expect, it } from "vitest";
import { createMachine, setup } from "xstate";
import { mergeMermaidDetail, mergeXStateDetail, type StateIR } from "@gmermaid/ir";
import { stateToMermaid } from "@gmermaid/mermaid-codegen";
import { parseStateDiagram } from "@gmermaid/mermaid-parser";
import { parseXStateMachine } from "./toIR";
import { stateToXState } from "./fromIR";

// Mermaid and XState are two projections of ONE IR (ADR 0002). These tests
// pin what each direction keeps and what it loses, and prove the editor's two
// commit paths do not destroy the other projection's detail.

function ofMermaid(code: string): StateIR {
  const r = parseStateDiagram(code);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.ir;
}
function ofXState(code: string): StateIR {
  const r = parseXStateMachine(code);
  if (!r.ok) throw new Error(r.errors.map((e) => `line ${e.line}: ${e.message}`).join("\n"));
  return r.ir;
}
function accepted(code: string): void {
  const body = code
    .split("\n")
    .filter((l) => !l.startsWith("import "))
    .join("\n")
    .replace("export const machine =", "return");
  expect(() => (new Function("setup", "createMachine", body) as (s: unknown, c: unknown) => unknown)(setup, createMachine), code).not.toThrow();
}

describe("mermaid → XState", () => {
  it("turns [*] into initial/final and a label into event, guard and actions", () => {
    const ir = ofMermaid(`stateDiagram-v2
  [*] --> Idle
  Idle --> Busy : START [hasWork] / begin, log
  Busy --> [*] : DONE
`);
    const out = stateToXState(ir);
    accepted(out.code);
    expect(out.code).toContain(`initial: "Idle"`);
    expect(out.code).toContain(`guard: "hasWork"`);
    expect(out.code).toContain(`type: "final"`);
    expect(out.warnings).toEqual([]);
  });

  it("an unlabelled arrow is an eventless `always` transition", () => {
    const out = stateToXState(ofMermaid(`stateDiagram-v2\n  [*] --> A\n  A --> B\n`));
    expect(out.code).toContain("always");
    accepted(out.code);
  });

  it("wraps a region that holds several states, and says which", () => {
    const ir = ofMermaid(`stateDiagram-v2
  [*] --> Active
  state Active {
    [*] --> NumLockOff
    NumLockOff --> NumLockOn : EvNumLockPressed
    --
    [*] --> CapsLockOff
    CapsLockOff --> CapsLockOn : EvCapsLockPressed
  }
`);
    const out = stateToXState(ir);
    accepted(out.code);
    expect(out.code).toContain(`type: "parallel"`);
    expect(out.code).toContain("region1");
    expect(out.warnings.join("\n")).toMatch(/region 1 of `Active` holds 2 states.*wrapped in `region1`/);
  });

  it("says out loud that notes are not part of the machine", () => {
    const out = stateToXState(ofMermaid(`stateDiagram-v2\n  [*] --> A\n  note right of A : think\n`));
    expect(out.warnings.join("\n")).toMatch(/note\(s\) are a mermaid-only feature/);
  });
});

describe("XState → mermaid", () => {
  it("draws nested states, regions and finals the canvas understands", () => {
    const ir = ofXState(`createMachine({
      initial: "idle",
      states: {
        idle: { entry: "reset", on: { GO: "work" } },
        work: {
          type: "parallel",
          states: {
            left: { initial: "a", states: { a: { on: { X: "b" } }, b: {} } },
            right: { initial: "c", states: { c: {} } },
          },
          on: { STOP: "done" },
        },
        done: { type: "final" },
      },
    })`);
    const mermaid = stateToMermaid(ir);
    expect(mermaid).toContain("[*] --> idle");
    expect(mermaid).toContain("idle --> work : GO");
    expect(mermaid).toContain("--");
    expect(mermaid).toContain("work --> [*] : STOP");
    // the mermaid text re-reads into the same shape, minus the XState detail
    const back = ofMermaid(mermaid);
    expect(back.states.map((s) => s.id).toSorted()).toEqual(ir.states.map((s) => s.id).toSorted());
    expect(back.states.find((s) => s.id === ("idle" as never))?.xstate).toBeUndefined();
  });
});

describe("the editor's two commit paths", () => {
  const source = `createMachine({
    initial: "idle",
    states: {
      idle: { entry: "reset", invoke: { src: "watch" }, on: { GO: "work" } },
      work: { exit: "flush" },
    },
  })`;

  it("a mermaid edit keeps entry/exit/invoke alive", () => {
    const before = ofXState(source);
    const edited = stateToMermaid(before).replace("stateDiagram-v2\n", "stateDiagram-v2\n  work --> idle : BACK\n");
    const after = mergeXStateDetail(before, ofMermaid(edited));
    expect(after.states.find((s) => s.id === ("idle" as never))?.xstate?.entry).toEqual(["reset"]);
    expect(after.states.find((s) => s.id === ("work" as never))?.xstate?.exit).toEqual(["flush"]);
    expect(after.transitions.some((t) => t.label === "BACK")).toBe(true);
    // and the XState text follows the mermaid edit
    expect(stateToXState(after).code).toContain("BACK");
  });

  it("a mermaid edit that deletes a state takes its XState detail with it", () => {
    const before = ofXState(source);
    const after = mergeXStateDetail(before, ofMermaid(`stateDiagram-v2\n  [*] --> idle\n`));
    expect(after.states.some((s) => s.id === ("work" as never))).toBe(false);
    expect(after.states.find((s) => s.id === ("idle" as never))?.xstate?.entry).toEqual(["reset"]);
  });

  it("an XState edit keeps notes and per-block directions alive", () => {
    const before = ofMermaid(`stateDiagram-v2
  direction LR
  [*] --> idle
  idle --> work : GO
  state work {
    direction TB
    [*] --> inner
  }
  note right of idle : keep me
`);
    const after = mergeMermaidDetail(before, ofXState(source));
    expect(after.notes.map((n) => n.text)).toEqual(["keep me"]);
    expect(after.direction).toBe("LR");
    expect(stateToMermaid(after)).toContain("note right of idle : keep me");
  });
});
