import { describe, expect, it } from "vitest";
import { stateToMermaid } from "@gmermaid/mermaid-codegen";
import { parseStateDiagram } from "./statediagram";

const sortById = <T extends { id: string }>(xs: readonly T[]) => [...xs].toSorted((a, b) => a.id.localeCompare(b.id));
const edgeSet = (ts: readonly { from: string; to: string; label?: string }[]) =>
  ts.map((t) => `${t.from}→${t.to}:${t.label ?? ""}`).toSorted();

describe("parseStateDiagram", () => {
  it("parses states, [*] start/end, labeled transitions and direction", () => {
    const code = `stateDiagram-v2
  direction LR
  state "Idle state" as Still
  [*] --> Still
  Still --> Moving : push
  Moving --> [*]
`;
    const result = parseStateDiagram(code);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.direction).toBe("LR");
    expect(result.ir.states.map((s) => [s.id, s.label, s.role])).toEqual([
      ["Still", "Idle state", "normal"],
      ["state_start", "", "start"],
      ["Moving", "Moving", "normal"],
      ["state_end", "", "end"],
    ]);
    expect(result.ir.transitions.map((t) => [t.from, t.to, t.label])).toEqual([
      ["state_start", "Still", undefined],
      ["Still", "Moving", "push"],
      ["Moving", "state_end", undefined],
    ]);
    // round trip: gen(parse(x)) reparses to the same IR, and gen is stable
    const regen = stateToMermaid(result.ir);
    const back = parseStateDiagram(regen);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.ir).toEqual(result.ir);
    expect(stateToMermaid(back.ir)).toBe(regen);
  });

  it("parses composite states with scoped [*], choice/fork/join and notes", () => {
    const code = `stateDiagram-v2
  [*] --> NotShooting
  state "Not shooting" as NotShooting {
    [*] --> Idle
    Idle --> Configuring : EvConfig
  }
  state c1 <<choice>>
  state f1 <<fork>>
  state j1 <<join>>
  NotShooting --> c1
  c1 --> f1 : yes
  f1 --> j1
  note right of NotShooting : safety on
  note left of c1
    multi
    line
  end note
`;
    const result = parseStateDiagram(code);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byId = new Map(result.ir.states.map((s) => [s.id as string, s]));
    // the [*] inside the block is scoped to it — a separate pseudo-state
    expect(byId.get("state_start")).toMatchObject({ role: "start" });
    expect(byId.get("state_start_NotShooting")).toMatchObject({ role: "start", parent: "NotShooting" });
    expect(byId.get("Idle")).toMatchObject({ parent: "NotShooting" });
    expect(byId.get("NotShooting")).toMatchObject({ label: "Not shooting" });
    expect(byId.get("c1")).toMatchObject({ role: "choice" });
    expect(byId.get("f1")).toMatchObject({ role: "fork" });
    expect(byId.get("j1")).toMatchObject({ role: "join" });
    expect(result.ir.notes).toEqual([
      { id: "note-1", target: "NotShooting", position: "rightOf", text: "safety on" },
      { id: "note-2", target: "c1", position: "leftOf", text: "multi\nline" },
    ]);
    // round trip: blocks regroup members, so state ORDER may shift once —
    // content must survive, and the text form must be a fixpoint after that
    const regen = stateToMermaid(result.ir);
    const back = parseStateDiagram(regen);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(sortById(back.ir.states)).toEqual(sortById(result.ir.states));
    // transitions regroup into their blocks: ids renumber, the set survives
    expect(edgeSet(back.ir.transitions)).toEqual(edgeSet(result.ir.transitions));
    expect(back.ir.notes).toEqual(result.ir.notes);
    expect(stateToMermaid(back.ir)).toBe(regen);
  });

  it("accepts `id : description` and the plain stateDiagram header", () => {
    const result = parseStateDiagram("stateDiagram\n  Still : just idling\n  Still --> Done\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.states[0]).toMatchObject({ id: "Still", label: "just idling" });
  });

  it("rejects unknown constructs with a line number", () => {
    // `--` concurrency regions are still unsupported
    const result = parseStateDiagram("stateDiagram-v2\n  state X {\n    A\n    --\n    B\n  }\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.line).toBe(4);
  });
});
