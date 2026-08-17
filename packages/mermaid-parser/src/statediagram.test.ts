import { describe, expect, it } from "vitest";
import { stateToMermaid } from "@gmermaid/mermaid-codegen";
import { parseStateDiagram } from "./statediagram";

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

  it("accepts `id : description` and the plain stateDiagram header", () => {
    const result = parseStateDiagram("stateDiagram\n  Still : just idling\n  Still --> Done\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.states[0]).toMatchObject({ id: "Still", label: "just idling" });
  });

  it("rejects unknown constructs with a line number", () => {
    const result = parseStateDiagram("stateDiagram-v2\n  state fork1 <<fork>>\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.line).toBe(2);
  });
});
