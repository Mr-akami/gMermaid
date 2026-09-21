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
    const result = parseStateDiagram("stateDiagram-v2\n  state X {\n    A\n    A ==> B\n  }\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.line).toBe(4);
    // `--` only makes sense inside a block
    const stray = parseStateDiagram("stateDiagram-v2\n  A\n  --\n  B\n");
    expect(stray.ok).toBe(false);
    if (stray.ok) return;
    expect(stray.errors[0]!).toMatchObject({ line: 3 });
  });

  it("parses `--` concurrency regions with per-region [*] and a per-block direction", () => {
    const code = `stateDiagram-v2
  [*] --> Active
  state Active {
    direction LR
    [*] --> NumLockOff
    NumLockOff --> NumLockOn : EvNumLockPressed
    --
    [*] --> CapsLockOff
    CapsLockOff --> [*]
    --
    state ScrollLockOff
  }
`;
    const result = parseStateDiagram(code);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const byId = new Map(result.ir.states.map((s) => [s.id as string, s]));
    expect(byId.get("Active")).toMatchObject({ direction: "LR" });
    expect("region" in byId.get("Active")!).toBe(false);
    // region 0 members carry no region field; later regions are indexed
    expect(byId.get("state_start_Active")).toMatchObject({ role: "start", parent: "Active" });
    expect("region" in byId.get("NumLockOff")!).toBe(false);
    expect(byId.get("state_start_Active_r1")).toMatchObject({ role: "start", parent: "Active", region: 1 });
    expect(byId.get("state_end_Active_r1")).toMatchObject({ role: "end", parent: "Active", region: 1 });
    expect(byId.get("CapsLockOff")).toMatchObject({ parent: "Active", region: 1 });
    expect(byId.get("ScrollLockOff")).toMatchObject({ parent: "Active", region: 2 });
    // codegen groups members by region and separates the groups with `--`
    const regen = stateToMermaid(result.ir);
    expect(regen).toBe(`stateDiagram-v2
  state Active {
    direction LR
    state NumLockOff
    state NumLockOn
    [*] --> NumLockOff
    --
    state CapsLockOff
    [*] --> CapsLockOff
    CapsLockOff --> [*]
    --
    state ScrollLockOff
  }
  [*] --> Active
  NumLockOff --> NumLockOn : EvNumLockPressed
`);
    const back = parseStateDiagram(regen);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(sortById(back.ir.states)).toEqual(sortById(result.ir.states));
    expect(edgeSet(back.ir.transitions)).toEqual(edgeSet(result.ir.transitions));
    expect(stateToMermaid(back.ir)).toBe(regen);
  });

  it("round-trips multi-line notes in block form and self-transitions", () => {
    const code = `stateDiagram-v2
  A --> A : tick
  A --> B: no space before the label
  note right of A
    first #lt;line#gt;
    second
  end note
`;
    const result = parseStateDiagram(code);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(edgeSet(result.ir.transitions)).toEqual(["A\u2192A:tick", "A\u2192B:no space before the label"]);
    expect(result.ir.notes[0]!.text).toBe("first <line>\nsecond");
    const regen = stateToMermaid(result.ir);
    expect(regen).toContain("  note right of A\n    first #lt;line#gt;\n    second\n  end note\n");
    const back = parseStateDiagram(regen);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.ir).toEqual(result.ir);
  });
});

const roundTripLenient = (code: string) => {
  const result = parseStateDiagram(code);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  const regen = stateToMermaid(result.ir);
  const back = parseStateDiagram(regen);
  expect(back.ok, regen).toBe(true);
  if (!back.ok) throw new Error("unreachable");
  expect(back.ir).toEqual(result.ir);
  return result.ir;
};

describe("parseStateDiagram dialect leniency", () => {
  it("strips `:::className` from state ids instead of mis-parsing them as labels", () => {
    const ir = roundTripLenient(`stateDiagram-v2
  [*] --> Still:::notMoving
  Still --> Moving:::movement
  Crash:::badBadEvent --> [*]
  classDef notMoving fill:white
  classDef badBadEvent fill:#f00,color:white
  class Still notMoving
`);
    expect(ir.states.map((s) => [s.id, s.label])).toEqual([
      ["state_start", ""],
      ["Still", "Still"],
      ["Moving", "Moving"],
      ["Crash", "Crash"],
      ["state_end", ""],
    ]);
    expect(edgeSet(ir.transitions)).toEqual(["Crash→state_end:", "Still→Moving:", "state_start→Still:"]);
  });

  it("accepts frontmatter, init directives, `stateDiagram` header, trailing `;`/`%%`, style, accTitle/accDescr", () => {
    const ir = roundTripLenient(`---
title: S
---
%%{init: {'theme':'dark'}}%%
stateDiagram;
  accTitle: t
  accDescr {
    d
  }
  hide empty description
  A --> B : go; %% comment
  style A fill:#f9f
`);
    expect(edgeSet(ir.transitions)).toEqual(["A→B:go"]);
  });

  it("accepts non-ASCII ids and `.` inside ids", () => {
    const ir = roundTripLenient(`stateDiagram-v2
  state "説明" as 日本
  日本 --> svc.api
  note right of svc.api : n
`);
    expect(ir.states.map((s) => [s.id, s.label])).toEqual([
      ["日本", "説明"],
      ["svc.api", "svc.api"],
    ]);
  });
});
